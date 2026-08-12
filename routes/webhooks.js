/**
 * Paystack webhook handler — verifies x-paystack-signature (HMAC SHA512).
 */
const paystackService = require('../payments/paystack-service');

async function paystackWebhookHandler(req, res) {
   if (!process.env.PAYSTACK_SECRET_KEY) {
      console.warn('Paystack webhook received but PAYSTACK_SECRET_KEY is not set');
      return res.status(503).send('Webhook not configured');
   }

   const signature = req.headers['x-paystack-signature'];
   const isValid = paystackService.verifyWebhookSignature(req.body, signature);

   if (!isValid) {
      console.error('Paystack webhook signature verification failed');
      return res.status(400).send('Invalid signature');
   }

   let event;
   try {
      event = JSON.parse(req.body.toString());
   } catch (error) {
      return res.status(400).send('Invalid JSON payload');
   }

   try {
      await paystackService.handleWebhookEvent(event);
      res.sendStatus(200);
   } catch (error) {
      console.error('Paystack webhook handler error:', error.message);
      res.status(500).json({ error: 'Webhook handler failed' });
   }
}

module.exports = { paystackWebhookHandler };
