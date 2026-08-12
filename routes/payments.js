const express = require('express');
const { getPaidPlans, getPlanById, isPaystackConfigured, formatPrice } = require('../config/plans');
const paystackService = require('../payments/paystack-service');
const { resolvePremiumStatus } = require('../payments/middleware');
const storage = require('../payments/storage');

const router = express.Router();

function getBaseUrl(req) {
   return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

router.get('/pricing', (req, res) => {
   res.render('pricing', {
      plans: getPaidPlans(),
      freePlan: getPlanById('free'),
      isPremium: resolvePremiumStatus(req),
      premiumPlan: req.session.premiumPlan,
      paystackConfigured: isPaystackConfigured(),
      paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
      formatPrice,
      upgrade: req.query.upgrade === '1',
      error: req.query.error || null,
      defaultEmail: req.user?.email || req.session.assessmentData?.email || ''
   });
});

router.post('/checkout', async (req, res) => {
   const { planId, email } = req.body;

   if (!isPaystackConfigured()) {
      return res.redirect('/pricing?error=' + encodeURIComponent('Payment system is not configured. Add Paystack keys to .env'));
   }

   const plan = getPlanById(planId);
   if (!plan || plan.id === 'free') {
      return res.redirect('/pricing?error=' + encodeURIComponent('Please select a valid plan'));
   }

   const customerEmail = (email || req.user?.email || req.session.assessmentData?.email || '').trim();
   if (!customerEmail) {
      return res.redirect('/pricing?error=' + encodeURIComponent('Please enter your email address to continue'));
   }

   try {
      const baseUrl = getBaseUrl(req);
      const payment = await paystackService.initializeTransaction({
         planId: plan.id,
         email: customerEmail,
         callbackUrl: `${baseUrl}/payment/verify`,
         metadata: {
            expressSessionId: req.sessionID
         }
      });

      req.session.pendingPaymentReference = payment.reference;
      req.session.pendingPlanId = plan.id;
      res.redirect(303, payment.authorizationUrl);
   } catch (error) {
      console.error('Checkout error:', error.message);
      res.redirect('/pricing?error=' + encodeURIComponent(error.message));
   }
});

router.get('/payment/verify', async (req, res) => {
   const reference = req.query.reference || req.session.pendingPaymentReference;

   if (!reference) {
      return res.redirect('/pricing?error=' + encodeURIComponent('Invalid payment reference'));
   }

   try {
      const result = await paystackService.activatePremiumFromReference(req, reference);

      delete req.session.pendingPaymentReference;
      delete req.session.pendingPlanId;

      if (!result.success) {
         return res.redirect('/pricing?error=' + encodeURIComponent(result.error || 'Payment verification failed'));
      }

      const returnTo = req.session.returnTo || '/results';
      delete req.session.returnTo;

      res.render('payment-success', {
         planId: result.planId,
         plan: getPlanById(result.planId),
         returnTo,
         reference: result.reference
      });
   } catch (error) {
      console.error('Payment verify error:', error.message);
      res.redirect('/pricing?error=' + encodeURIComponent('Could not verify payment. Contact support if you were charged.'));
   }
});

router.get('/payment/success', (req, res) => {
   res.redirect('/payment/verify?' + new URLSearchParams(req.query).toString());
});

router.get('/payment/cancel', (req, res) => {
   res.render('payment-cancel');
});

router.get('/billing', (req, res) => {
   if (!resolvePremiumStatus(req)) {
      return res.redirect('/pricing?upgrade=1');
   }

   const customerId = req.session.paymentCustomerId;
   const record = customerId ? storage.getCustomerRecord(customerId) : null;

   res.render('billing', {
      isPremium: true,
      premiumPlan: req.session.premiumPlan,
      plan: getPlanById(req.session.premiumPlan),
      expiresAt: req.session.premiumExpiresAt,
      subscriptionCode: req.session.paystackSubscriptionCode,
      email: record?.email || req.session.assessmentData?.email || '',
      formatPrice,
      cancelled: req.query.cancelled === '1',
      error: req.query.error || null
   });
});

router.post('/billing/cancel-subscription', async (req, res) => {
   const { emailToken } = req.body;
   const subscriptionCode = req.session.paystackSubscriptionCode;

   if (!subscriptionCode || !emailToken) {
      return res.redirect('/billing?error=' + encodeURIComponent('Subscription code and email token are required'));
   }

   try {
      await paystackService.disableSubscription(subscriptionCode, emailToken);
      req.session.isPremium = false;
      req.session.premiumPlan = null;
      req.session.premiumExpiresAt = new Date().toISOString();
      res.redirect('/billing?cancelled=1');
   } catch (error) {
      console.error('Cancel subscription error:', error.message);
      res.redirect('/billing?error=' + encodeURIComponent(error.message));
   }
});

router.get('/payment/status', (req, res) => {
   res.json({
      isPremium: resolvePremiumStatus(req),
      plan: req.session.premiumPlan || 'free',
      expiresAt: req.session.premiumExpiresAt || null,
      currency: 'NGN',
      provider: 'paystack',
      paystackConfigured: isPaystackConfigured()
   });
});

module.exports = router;
