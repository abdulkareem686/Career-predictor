const express = require('express');
const { passport, isGoogleConfigured } = require('../auth/passport');
const { syncPremiumForUser, loadUserProgress } = require('../auth/middleware');

const router = express.Router();

function getReturnTo(req) {
   const target = req.session.returnTo || '/assessment';
   delete req.session.returnTo;
   return target;
}

router.get('/login', (req, res) => {
   if (req.isAuthenticated && req.isAuthenticated()) {
      return res.redirect('/assessment');
   }
   res.render('login', {
      googleConfigured: isGoogleConfigured(),
      error: req.query.error || null
   });
});

router.get('/signup', (req, res) => {
   if (req.isAuthenticated && req.isAuthenticated()) {
      return res.redirect('/assessment');
   }
   res.render('signup', {
      googleConfigured: isGoogleConfigured(),
      error: req.query.error || null
   });
});

router.get('/auth/google', (req, res, next) => {
   if (!isGoogleConfigured()) {
      return res.redirect('/login?error=' + encodeURIComponent('Google sign-in is not configured yet'));
   }
   passport.authenticate('google', {
      scope: ['profile', 'email'],
      prompt: 'select_account'
   })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
   if (!isGoogleConfigured()) {
      return res.redirect('/login?error=' + encodeURIComponent('Google sign-in is not configured'));
   }

   passport.authenticate('google', (err, user) => {
      if (err) {
         console.error('Google callback error:', err.message);
         return res.redirect('/login?error=' + encodeURIComponent('Sign-in failed. Please try again.'));
      }
      if (!user) {
         return res.redirect('/login?error=' + encodeURIComponent('Google sign-in was cancelled or failed.'));
      }

      req.logIn(user, (loginErr) => {
         if (loginErr) {
            console.error('Session login error:', loginErr.message);
            return res.redirect('/login?error=' + encodeURIComponent('Could not create session. Please try again.'));
         }

         syncPremiumForUser(req);
         loadUserProgress(req);

         if (req.user?.email) {
            req.session.assessmentData = {
               ...(req.session.assessmentData || {}),
               email: req.user.email,
               studentName: req.session.assessmentData?.studentName || req.user.name
            };
         }

         return res.redirect(getReturnTo(req));
      });
   })(req, res, next);
});

router.get('/logout', (req, res) => {
   req.logout((err) => {
      if (err) console.error('Logout error:', err.message);
      req.session.destroy(() => {
         res.redirect('/');
      });
   });
});

router.get('/profile', (req, res) => {
   if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.redirect('/login');
   }
   res.render('profile', {
      user: req.user,
      isPremium: req.session.isPremium || false,
      premiumPlan: req.session.premiumPlan || null
   });
});

module.exports = router;
