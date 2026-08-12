const { PLANS } = require('../config/plans');
const storage = require('./storage');
const { syncSessionFromCustomerRecord } = require('./paystack-service');

function resolvePremiumStatus(req) {
   if (req.session.isPremium) {
      if (req.session.premiumExpiresAt && new Date(req.session.premiumExpiresAt) < new Date()) {
         req.session.isPremium = false;
         return false;
      }
      return true;
   }

   const customerId = req.session.paymentCustomerId || req.session.stripeCustomerId;
   if (customerId) {
      const record = storage.getCustomerRecord(customerId);
      return syncSessionFromCustomerRecord(req, record);
   }

   return false;
}

function attachPremiumStatus(req, res, next) {
   res.locals.isPremium = resolvePremiumStatus(req);
   res.locals.premiumPlan = req.session.premiumPlan || null;
   res.locals.planLimits = res.locals.isPremium
      ? PLANS[req.session.premiumPlan]?.limits || PLANS.pro_monthly.limits
      : PLANS.free.limits;
   next();
}

function requirePremium(req, res, next) {
   if (resolvePremiumStatus(req)) {
      return next();
   }
   req.session.returnTo = req.originalUrl;
   return res.redirect('/pricing?upgrade=1');
}

function limitResultsForFree(results, isPremium) {
   if (isPremium || !results) return results;

   return {
      ...results,
      careers: (results.careers || []).slice(0, PLANS.free.limits.careers),
      courses: (results.courses || []).slice(0, PLANS.free.limits.courses)
   };
}

module.exports = {
   attachPremiumStatus,
   requirePremium,
   resolvePremiumStatus,
   limitResultsForFree
};
