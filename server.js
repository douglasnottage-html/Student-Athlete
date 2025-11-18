const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.raw({type: 'application/json'}));
app.use(express.static('public'));

const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUCCESS_URL = process.env.SUCCESS_URL || 'http://localhost:4242?session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL = process.env.CANCEL_URL || 'http://localhost:4242?canceled=true';

const stripe = STRIPE_SECRET ? Stripe(STRIPE_SECRET) : null;
const issuedTokens = {};

// Demo purchase
app.post('/demo-purchase', (req, res)=>{
  const email = (req.body && req.body.email) || 'demo@example.com';
  const token = crypto.randomBytes(16).toString('hex');
  issuedTokens[token] = {email, files:[0,1,2,3], expires: Date.now() + 1000*60*60*24};
  res.json({ok:true, token});
});

// Stripe checkout
app.post('/create-checkout-session', async (req, res)=>{
  if(!stripe) return res.status(500).json({error:'Stripe not configured.'});
  try{
    const session = await stripe.checkout.sessions.create({
      payment_method_types:['card'],
      mode:'payment',
      line_items:[{price: STRIPE_PRICE_ID, quantity:1}],
      success_url: SUCCESS_URL.replace('{CHECKOUT_SESSION_ID}','{CHECKOUT_SESSION_ID}'),
      cancel_url: CANCEL_URL,
    });
    res.json({url: session.url});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

// Verify session
app.post('/verify-session', async (req, res)=>{
  const sid = req.body && req.body.session_id;
  if(!stripe) return res.json({ok:false});
  try{
    const session = await stripe.checkout.sessions.retrieve(sid);
    if(session && session.payment_status==='paid'){
      const token = crypto.randomBytes(16).toString('hex');
      issuedTokens[token] = {email: session.customer_details?.email||'buyer', files:[0,1,2,3], expires: Date.now()+1000*60*60*24};
      return res.json({ok:true, token});
    }
    res.json({ok:false});
  }catch(e){ console.error(e); res.json({ok:false}); }
});

// Webhook
app.post('/webhook', (req,res)=>{
  if(!STRIPE_WEBHOOK_SECRET || !stripe) return res.status(400).send('webhook not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try{ event = stripe.webhooks.constructEvent(req.body,sig,STRIPE_WEBHOOK_SECRET); } 
  catch(e){ return res.status(400).send(`Webhook Error: ${e.message}`); }
  if(event.type==='checkout.session.completed'){
    const session = event.data.object;
    const token = crypto.randomBytes(16).toString('hex');
    issuedTokens[token] = {email: session.customer_details?.email||'buyer', files:[0,1,2,3], expires: Date.now()+1000*60*60*24};
    console.log('Issued token for', issuedTokens[token]);
  }
  res.json({received:true});
});

// Protected file (demo PDF)
app.get('/protected-file', (req,res)=>{
  const token = req.query.token;
  const idx = Number(req.query.file||0);
  const record = issuedTokens[token];
  if(!record || record.expires<Date.now()) return res.status(401).send('Unauthorized or token expired');
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="demo.pdf"');
  res.send(Buffer.from('JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoK', 'base64'));
});

const port = process.env.PORT || 4242;
app.listen(port, ()=>console.log('Server running on', port));
