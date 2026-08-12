const crypto = require('crypto');
const https = require('https');
const {
   getPlanById,
   getPaystackPlanCode,
   getAmountInKobo,
   isPaystackConfigured,
   calculateExpiry
} = require('../config/plans');
const storage = require('./storage');

const PAYSTACK_BASE = 'https://api.paystack.co';

function getSecretKey() {
   return process.env.PAYSTACK_SECRET_KEY || '';
}

async function paystackRequest(path, options = {}) {
   const secretKey = getSecretKey();
   if (!secretKey) {
      throw new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY in .env');
   }

   const body = options.body || null;
   const method = options.method || 'GET';

   return new Promise((resolve, reject) => {
      const url = new URL(`${PAYSTACK_BASE}${path}`);
      const req = https.request({
         hostname: url.hostname,
         path: url.pathname + url.search,
         method,
         headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
         }
      }, (res) => {
         let data = '';
         res.on('data', (chunk) => { data += chunk; });
         res.on('end', () => {
            try {
               const payload = JSON.parse(data);
               if (res.statusCode >= 400 || payload.status === false) {
                  reject(new Error(payload.message || 'Paystack request failed'));
               } else {
                  resolve(payload);
               }
            } catch (error) {
               reject(new Error('Invalid Paystack response'));
            }
         });
      });

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
   });
}

function generateReference() {
   return `cp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function initializeTransaction({ planId, email, callbackUrl, metadata = {} }) {
   if (!isPaystackConfigured()) {
      throw new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY in .env');
   }

   const plan = getPlanById(planId);
   if (!plan || plan.id === 'free') {
      throw new Error('Invalid plan selected');
   }

   if (!email) {
      throw new Error('Email is required for payment');
   }

   const reference = generateReference();
   const body = {
      email,
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      channels: ['card', 'bank', 'bank_transfer', 'ussd', 'qr'],
      metadata: {
         planId: plan.id,
         ...metadata
      }
   };

   const planCode = getPaystackPlanCode(planId);
   const amountInKobo = getAmountInKobo(planId);

   if (amountInKobo < 100) {
      throw new Error('Invalid payment amount for this plan');
   }

   // Use Paystack subscription plan only when a real plan code is configured
   if ((plan.interval === 'month' || plan.interval === 'year') && planCode) {
      body.plan = planCode;
   } else {
      // One-time charge in kobo (NGN × 100); access period tracked in-app
      body.amount = amountInKobo;
   }

   const result = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(body)
   });

   return {
      authorizationUrl: result.data.authorization_url,
      accessCode: result.data.access_code,
      reference: result.data.reference
   };
}

async function verifyTransaction(reference) {
   if (!reference) return null;
   const result = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
   return result.data;
}

async function disableSubscription(subscriptionCode, emailToken) {
   return paystackRequest('/subscription/disable', {
      method: 'POST',
      body: JSON.stringify({ code: subscriptionCode, token: emailToken })
   });
}

async function fetchSubscription(subscriptionCode) {
   return paystackRequest(`/subscription/${encodeURIComponent(subscriptionCode)}`);
}

function applyPremiumToSession(req, premiumData) {
   req.session.isPremium = true;
   req.session.premiumPlan = premiumData.planId;
   req.session.paymentCustomerId = premiumData.customerId || req.session.paymentCustomerId;
   req.session.paystackSubscriptionCode = premiumData.subscriptionCode || null;
   req.session.paymentReference = premiumData.reference || req.session.paymentReference;
   req.session.premiumExpiresAt = premiumData.expiresAt || null;
   req.session.premiumActivatedAt = premiumData.activatedAt || new Date().toISOString();
}

function clearPremiumSession(req) {
   req.session.isPremium = false;
   req.session.premiumPlan = null;
   req.session.paystackSubscriptionCode = null;
   req.session.premiumExpiresAt = null;
}

function syncSessionFromCustomerRecord(req, record) {
   if (!record || !record.isPremium) {
      clearPremiumSession(req);
      return false;
   }

   if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      clearPremiumSession(req);
      return false;
   }

   applyPremiumToSession(req, {
      planId: record.planId,
      customerId: record.customerId,
      subscriptionCode: record.subscriptionCode,
      reference: record.reference,
      expiresAt: record.expiresAt,
      activatedAt: record.activatedAt
   });
   return true;
}

function activatePremiumFromVerification(req, verification, reference) {
   if (!verification || verification.status !== 'success') {
      return { success: false, error: 'Payment not completed' };
   }

   const planId = verification.metadata?.planId || 'pro_monthly';
   const customerId = verification.customer?.customer_code || verification.customer?.email || reference;
   const subscriptionCode = verification.plan_object?.subscription_code
      || verification.authorization?.subscription_code
      || null;

   let expiresAt = calculateExpiry(planId);
   if (planId === 'lifetime') {
      expiresAt = null;
   }

   const record = storage.upsertCustomer(customerId, {
      reference,
      planId,
      subscriptionCode,
      isPremium: true,
      expiresAt,
      activatedAt: new Date().toISOString(),
      email: verification.customer?.email || verification.customer_email || null,
      amountPaid: verification.amount,
      currency: verification.currency || 'NGN'
   });

   applyPremiumToSession(req, {
      planId: record.planId,
      customerId: record.customerId,
      subscriptionCode: record.subscriptionCode,
      reference: record.reference,
      expiresAt: record.expiresAt,
      activatedAt: record.activatedAt
   });

   storage.recordPaymentEvent({
      type: 'charge.success',
      reference,
      customerId,
      planId
   });

   return { success: true, planId, customerId, reference };
}

async function activatePremiumFromReference(req, reference) {
   const verification = await verifyTransaction(reference);
   return activatePremiumFromVerification(req, verification, reference);
}

function verifyWebhookSignature(body, signature) {
   const secret = getSecretKey();
   if (!secret || !signature) return false;

   const hash = crypto
      .createHmac('sha512', secret)
      .update(body)
      .digest('hex');

   return hash === signature;
}

async function handleWebhookEvent(event) {
   const eventType = event.event;
   const data = event.data;

   switch (eventType) {
      case 'charge.success': {
         const reference = data.reference;
         const planId = data.metadata?.planId || 'pro_monthly';
         const customerId = data.customer?.customer_code || data.customer?.email || reference;
         const subscriptionCode = data.plan_object?.subscription_code || null;

         let expiresAt = calculateExpiry(planId);
         if (planId === 'lifetime') expiresAt = null;

         storage.upsertCustomer(customerId, {
            reference,
            planId,
            subscriptionCode,
            isPremium: true,
            expiresAt,
            activatedAt: new Date().toISOString(),
            email: data.customer?.email,
            amountPaid: data.amount,
            currency: data.currency || 'NGN'
         });

         storage.recordPaymentEvent({ type: eventType, reference, customerId, planId });
         break;
      }

      case 'subscription.create': {
         const customerId = data.customer?.customer_code || data.customer?.email;
         storage.upsertCustomer(customerId, {
            subscriptionCode: data.subscription_code,
            planId: data.plan?.plan_code ? 'pro_monthly' : (data.metadata?.planId || 'pro_monthly'),
            isPremium: true,
            expiresAt: data.next_payment_date || calculateExpiry('pro_monthly'),
            email: data.customer?.email
         });
         storage.recordPaymentEvent({ type: eventType, customerId, subscriptionCode: data.subscription_code });
         break;
      }

      case 'subscription.disable':
      case 'subscription.not_renew': {
         const customerId = data.customer?.customer_code || data.customer?.email;
         storage.upsertCustomer(customerId, {
            subscriptionCode: data.subscription_code,
            isPremium: false,
            expiresAt: new Date().toISOString()
         });
         storage.recordPaymentEvent({ type: eventType, customerId, subscriptionCode: data.subscription_code });
         break;
      }

      case 'invoice.payment_failed': {
         storage.recordPaymentEvent({
            type: eventType,
            customerId: data.customer?.customer_code,
            subscriptionCode: data.subscription?.subscription_code
         });
         break;
      }

      default:
         break;
   }
}

module.exports = {
   initializeTransaction,
   verifyTransaction,
   disableSubscription,
   fetchSubscription,
   activatePremiumFromReference,
   activatePremiumFromVerification,
   handleWebhookEvent,
   verifyWebhookSignature,
   applyPremiumToSession,
   clearPremiumSession,
   syncSessionFromCustomerRecord,
   isPaystackConfigured
};
