const paymentStorage = require('../payments/storage');
const { syncSessionFromCustomerRecord } = require('../payments/paystack-service');
const userStorage = require('./user-storage');

function attachUser(req, res, next) {
   res.locals.user = req.user || null;
   res.locals.isAuthenticated = Boolean(req.user);
   next();
}

function requireAuth(req, res, next) {
   if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
   }
   req.session.returnTo = req.originalUrl;
   return res.redirect('/login');
}

function syncPremiumForUser(req) {
   if (!req.user?.email) return;

   const record = paymentStorage.getCustomerByEmail(req.user.email);
   if (record) {
      syncSessionFromCustomerRecord(req, record);
   }
}

function loadUserProgress(req) {
   if (!req.user?.id) return;

   const progress = userStorage.getUserProgress(req.user.id);
   if (!progress) return;

   if (Object.keys(progress.assessmentData || {}).length > 0) {
      req.session.assessmentData = progress.assessmentData;
   }
   if (progress.recommendations) {
      req.session.recommendations = progress.recommendations;
   }
   if (progress.careerProfile) {
      req.session.careerProfile = progress.careerProfile;
   }
   if (progress.studentData) {
      req.session.studentData = progress.studentData;
   }
}

function saveUserProgress(req) {
   if (!req.user?.id) return;

   userStorage.updateUserProgress(req.user.id, {
      assessmentData: req.session.assessmentData || {},
      recommendations: req.session.recommendations || null,
      careerProfile: req.session.careerProfile || null,
      studentData: req.session.studentData || null
   });
}

module.exports = {
   attachUser,
   requireAuth,
   syncPremiumForUser,
   loadUserProgress,
   saveUserProgress
};
