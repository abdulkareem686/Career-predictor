/**
 * Nigerian pricing plans — amounts in NGN (Naira).
 * Paystack plan codes are optional env vars for recurring subscriptions.
 */
const PLANS = {
   free: {
      id: 'free',
      name: 'Free',
      price: 0,
      currency: 'NGN',
      currencySymbol: '₦',
      interval: null,
      description: 'Basic career assessment with limited insights',
      features: [
         'Complete career assessment',
         'Top 1 career & course match',
         'Basic personality overview',
         'Academic performance summary'
      ],
      limits: {
         careers: 1,
         courses: 1,
         scholarships: 0,
         skills: false,
         careerProfile: false
      }
   },
   pro_monthly: {
      id: 'pro_monthly',
      name: 'Pro Monthly',
      price: 4999,
      currency: 'NGN',
      currencySymbol: '₦',
      interval: 'month',
      paystackPlanEnv: 'PAYSTACK_PLAN_PRO_MONTHLY',
      description: 'Full access to all career guidance features',
      popular: false,
      features: [
         'Unlimited career & course matches',
         'Full AI career profile & counseling',
         'Scholarship finder with match scores',
         'Personalized skills roadmap',
         'Salary & industry growth analysis'
      ],
      limits: {
         careers: Infinity,
         courses: Infinity,
         scholarships: Infinity,
         skills: true,
         careerProfile: true
      }
   },
   pro_yearly: {
      id: 'pro_yearly',
      name: 'Pro Yearly',
      price: 39999,
      currency: 'NGN',
      currencySymbol: '₦',
      interval: 'year',
      paystackPlanEnv: 'PAYSTACK_PLAN_PRO_YEARLY',
      description: 'Best value — save ₦20,000 vs monthly',
      popular: true,
      savings: 'Save ₦20,000/year',
      features: [
         'Everything in Pro Monthly',
         'Priority support',
         'Early access to new features',
         'Annual career progress review'
      ],
      limits: {
         careers: Infinity,
         courses: Infinity,
         scholarships: Infinity,
         skills: true,
         careerProfile: true
      }
   },
   lifetime: {
      id: 'lifetime',
      name: 'Lifetime',
      price: 79999,
      currency: 'NGN',
      currencySymbol: '₦',
      interval: 'once',
      description: 'One-time payment, lifetime access',
      popular: false,
      features: [
         'Everything in Pro, forever',
         'No recurring charges',
         'All future updates included',
         'Best for long-term planning'
      ],
      limits: {
         careers: Infinity,
         courses: Infinity,
         scholarships: Infinity,
         skills: true,
         careerProfile: true
      }
   }
};

function formatPrice(amount, symbol = '₦') {
   return `${symbol}${Number(amount).toLocaleString('en-NG')}`;
}

function getPaidPlans() {
   return [PLANS.pro_monthly, PLANS.pro_yearly, PLANS.lifetime];
}

function getPlanById(planId) {
   return PLANS[planId] || null;
}

function isValidPaystackPlanCode(code) {
   if (!code || typeof code !== 'string') return false;
   const trimmed = code.trim();
   if (!trimmed.startsWith('PLN_')) return false;
   if (/your_|placeholder|example/i.test(trimmed)) return false;
   return trimmed.length > 8;
}

function getPaystackPlanCode(planId) {
   const plan = getPlanById(planId);
   if (!plan || !plan.paystackPlanEnv) return null;
   const code = process.env[plan.paystackPlanEnv] || null;
   return isValidPaystackPlanCode(code) ? code.trim() : null;
}

function getAmountInKobo(planId) {
   const plan = getPlanById(planId);
   if (!plan) return 0;
   return Math.round(plan.price * 100);
}

function isPaystackConfigured() {
   return Boolean(
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_PUBLIC_KEY
   );
}

function calculateExpiry(planId, fromDate = new Date()) {
   const plan = getPlanById(planId);
   if (!plan || plan.interval === 'once') return null;

   const expiry = new Date(fromDate);
   if (plan.interval === 'month') {
      expiry.setMonth(expiry.getMonth() + 1);
   } else if (plan.interval === 'year') {
      expiry.setFullYear(expiry.getFullYear() + 1);
   }
   return expiry.toISOString();
}

module.exports = {
   PLANS,
   formatPrice,
   getPaidPlans,
   getPlanById,
   getPaystackPlanCode,
   getAmountInKobo,
   isPaystackConfigured,
   calculateExpiry
};
