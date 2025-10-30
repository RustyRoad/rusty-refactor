# Checkout Service Refactor - Technical Specification

## Overview

Refactor the checkout flow to support one-click funnel upsells/downsells while maintaining dual tracking (local DB + Stripe). Eliminates webhook dependency for payment method saving to avoid race conditions.

## Goals

1. **One-click purchases** - Customer enters card info once, subsequent purchases are one-click
2. **Dual tracking** - Maintain both local customer/subscription records AND Stripe records
3. **Flexible purchase types** - Support one-time purchases, subscriptions, and mixed funnels
4. **Credit rollover** - Support tripwire → subscription upsell with credit application
5. **No race conditions** - Don't rely on webhook timing for critical flow
6. **Backward compatible** - Existing checkout endpoints continue working during migration

## Architecture

### Service Layer

Create new unified checkout service: `src/services/checkout/mod.rs`

```rust
pub struct CheckoutService {
    stripe: Client,
    pool: PgPool,
}

pub struct CustomerInfo {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub address_id: i32,
    pub trash_day: Option<String>,
}

pub struct InitialPurchaseRequest {
    pub customer_info: CustomerInfo,
    pub offer_id: i64,
    pub funnel_session_id: String,
    pub funnel_id: Option<i32>,
    pub variant: Option<String>,
}

pub struct InitialPurchaseResult {
    pub client_secret: String,
    pub payment_intent_id: String,
    pub stripe_customer_id: String,
    pub session_token: String,
    pub amount: i64,
}

pub struct PaymentMethodConfirmation {
    pub payment_method_id: String,
    pub payment_method_saved: bool,
    pub ready_for_upsells: bool,
    pub credits_issued: Option<i64>,
}

pub struct OneClickPurchaseRequest {
    pub session_token: String,
    pub offer_id: i64,
}

pub struct OneClickResult {
    pub success: bool,
    pub payment_intent_id: Option<String>,
    pub subscription_id: Option<String>,
    pub amount_charged: i64,
    pub credits_applied: i64,
    pub order_id: String,
}
```

### Core Methods

#### 1. Initial Purchase Flow

**Method**: `initial_purchase(request: InitialPurchaseRequest) -> Result<InitialPurchaseResult>`

**Purpose**: Create first payment intent that collects payment method for future use

**Steps**:
1. Resolve offer by ID from `offers` table
2. Get or create local customer in `customer` table
3. Get or create Stripe customer
4. Link local customer ↔ Stripe customer via `stripe_customer_id`
5. Determine purchase amount from offer configuration
6. Create PaymentIntent with:
   - `setup_future_usage: "off_session"` (saves card for later)
   - Customer ID attached
   - Metadata: offer_id, funnel_session_id, funnel_id, should_issue_credit
7. Create provisional order in `provisional_orders` table
8. Return client_secret for frontend payment confirmation

**Database Operations**:
```sql
-- Get or create customer
INSERT INTO customer (email, first_name, last_name, address_id, stripe_customer_id, pickup_day)
VALUES (...)
ON CONFLICT (email) DO UPDATE SET ...
RETURNING id;

-- Create provisional order
INSERT INTO provisional_orders (
  customer_id, offer_id, service_amount, total_amount, 
  funnel_session_id, variant, created_at
) VALUES (...);
```

#### 2. Payment Method Confirmation

**Method**: `confirm_payment_method_saved(payment_intent_id: String, session_token: String) -> Result<PaymentMethodConfirmation>`

**Purpose**: Synchronously retrieve and save payment method after frontend confirmation (no webhook dependency)

**Steps**:
1. Retrieve PaymentIntent from Stripe to get payment_method_id
2. Verify payment succeeded
3. **Immediately** save payment_method_id to session store
4. Check offer configuration for credit issuance
5. If configured, create entry in `credit_ledgers` table
6. Update provisional_order status to 'payment_confirmed'
7. Create final order record (if applicable)
8. Track conversion event in `funnel_events` table
9. Return confirmation with payment_method_id

**Database Operations**:
```sql
-- Issue rollover credit (if configured)
INSERT INTO credit_ledgers (
  customer_id, transaction_type, amount_cents, description,
  reference_id, expires_at, is_active, created_at
) VALUES (
  $1, 'credit', $2, 'Rollover credit from offer X',
  $3, NOW() + INTERVAL '30 days', true, NOW()
);

-- Update provisional order
UPDATE provisional_orders 
SET status = 'confirmed', updated_at = NOW()
WHERE id = $1;

-- Track funnel conversion
INSERT INTO funnel_events (
  session_id, customer_id, funnel_id, step_id,
  event_type, value_cents, offer_id, created_at
) VALUES (...);
```

#### 3. One-Click Purchase

**Method**: `one_click_purchase(request: OneClickPurchaseRequest) -> Result<OneClickResult>`

**Purpose**: Charge saved payment method without frontend interaction

**Steps**:
1. Retrieve payment_method_id from session using session_token
2. Retrieve customer_id and stripe_customer_id from session
3. Resolve offer by ID
4. Determine offer type (one_time vs subscription)
5. Check `credit_ledgers` for available credits
6. Calculate net amount after credits

**For one-time purchases**:
```rust
let mut params = CreatePaymentIntent::new(net_amount, Currency::USD);
params.customer = Some(stripe_customer_id);
params.payment_method = Some(payment_method_id);
params.off_session = Some(PaymentIntentOffSession::Literal(true));
params.confirm = Some(true); // Immediate charge
params.metadata = /* track offer, credits applied, etc */;

let pi = PaymentIntent::create(&stripe, params).await?;
```

**For subscriptions**:
```rust
let mut params = CreateSubscription::new(stripe_customer_id);
params.default_payment_method = Some(payment_method_id);
params.items = /* subscription items from offer */;

// Apply credits as coupon/discount if available
if credits_available > 0 {
    // Create one-time coupon or apply discount
}

let subscription = Subscription::create(&stripe, params).await?;
```

7. If subscription created, insert into `customer_subscriptions` table
8. Mark used credits as consumed in `credit_ledgers`
9. Create provisional_order record
10. Track conversion in `funnel_events`
11. Generate order_id
12. Trigger async operations (email, analytics)
13. Return result

**Database Operations**:
```sql
-- Consume credits
UPDATE credit_ledgers 
SET is_active = false, consumed_at = NOW()
WHERE customer_id = $1 
  AND is_active = true 
  AND expires_at > NOW()
ORDER BY created_at ASC
LIMIT $2; -- consume oldest first

-- Create subscription record (if applicable)
INSERT INTO customer_subscriptions (
  customer_id, subscription_id, start_date, status,
  service_frequency, next_service_date, available_for_routing
) VALUES (
  $1, /* stripe_subscription_id */, NOW(), 'active',
  /* from offer config */, /* calculated */, true
);

INSERT INTO subscription (
  stripe_subscription_id, product_id, price,
  currency, interval, active
) VALUES (...);

-- Track one-click conversion
INSERT INTO funnel_events (
  session_id, customer_id, funnel_id, step_id,
  event_type, value_cents, offer_id, created_at
) VALUES (...);
```

## API Endpoints

### POST /api/checkout/initial

**Request**:
```json
{
  "customer_info": {
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "address_id": 123,
    "trash_day": "Monday"
  },
  "offer_id": 1,
  "funnel_session_id": "uuid-v4",
  "funnel_id": 5,
  "variant": "control"
}
```

**Response**:
```json
{
  "client_secret": "pi_xxx_secret_yyy",
  "payment_intent_id": "pi_xxx",
  "stripe_customer_id": "cus_xxx",
  "session_token": "uuid-v4",
  "amount": 2900,
  "stripe_publishable_key": "pk_xxx"
}
```

### POST /api/checkout/confirm-payment-method

**Request**:
```json
{
  "payment_intent_id": "pi_xxx",
  "session_token": "uuid-v4"
}
```

**Response**:
```json
{
  "payment_method_id": "pm_xxx",
  "payment_method_saved": true,
  "ready_for_upsells": true,
  "credits_issued": 2900
}
```

### POST /api/checkout/one-click

**Request**:
```json
{
  "session_token": "uuid-v4",
  "offer_id": 2
}
```

**Response**:
```json
{
  "success": true,
  "payment_intent_id": "pi_yyy",
  "subscription_id": "sub_zzz",
  "amount_charged": 6000,
  "credits_applied": 2900,
  "order_id": "ORD-20251023-12345"
}
```

## Session Management

### Session Storage

Store in Actix session (backed by Redis):

```rust
// After initial purchase
session.insert("funnel_session_token", session_token)?;
session.insert("customer_id", customer_id)?;
session.insert("stripe_customer_id", stripe_customer_id.to_string())?;

// After payment method confirmation
session.insert("payment_method_id", payment_method_id.to_string())?;

// Funnel tracking
session.insert("funnel_id", funnel_id)?;
session.insert("current_step", "upsell_1")?;
```

### Session Lifecycle

- **Created**: When initial_purchase called
- **Updated**: After each funnel step
- **Expires**: 24 hours after last activity
- **Cleared**: After final purchase or explicit logout

## Offer Configuration

### Offers Table Schema

```sql
CREATE TABLE offers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  offer_type VARCHAR NOT NULL, -- 'one_time' or 'subscription'
  stripe_product_id VARCHAR,
  stripe_price_id VARCHAR,
  local_product_id INTEGER,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Offer Payload Examples

**One-time with credit issuance**:
```json
{
  "purchase_type": "one_time",
  "amount_cents": 2900,
  "issue_rollover_credit": true,
  "credit_duration_days": 30,
  "credit_description": "Rollover credit from tripwire offer"
}
```

**Subscription accepting credits**:
```json
{
  "purchase_type": "subscription",
  "stripe_price_id": "price_xxx",
  "interval": "month",
  "accept_credits": true,
  "apply_credits_to": "first_payment"
}
```

## Credit Management

### Credit Ledger Operations

**Issue Credit**:
```rust
async fn issue_credit(
    customer_id: i32,
    amount_cents: i64,
    description: &str,
    reference_id: &str,
    expires_days: i32
) -> Result<CreditLedger> {
    let expires_at = chrono::Utc::now() + chrono::Duration::days(expires_days);
    
    CreditLedger::create(
        customer_id,
        "credit",
        amount_cents,
        description,
        Some(reference_id),
        Some(expires_at)
    ).await
}
```

**Apply Credits**:
```rust
async fn apply_credits(
    customer_id: i32,
    max_amount: i64
) -> Result<Vec<CreditLedger>> {
    // Get active, non-expired credits
    let credits = sqlx::query_as!(
        CreditLedger,
        "SELECT * FROM credit_ledgers 
         WHERE customer_id = $1 
           AND is_active = true 
           AND expires_at > NOW()
         ORDER BY created_at ASC",
        customer_id
    )
    .fetch_all(&pool)
    .await?;
    
    let mut remaining = max_amount;
    let mut applied = Vec::new();
    
    for credit in credits {
        if remaining <= 0 { break; }
        
        let to_apply = credit.amount_cents.min(remaining);
        remaining -= to_apply;
        
        // Mark as consumed
        sqlx::query!(
            "UPDATE credit_ledgers 
             SET is_active = false, consumed_at = NOW()
             WHERE id = $1",
            credit.id
        )
        .execute(&pool)
        .await?;
        
        applied.push(credit);
    }
    
    Ok(applied)
}
```

## Frontend Integration

### Initial Purchase Flow

```typescript
// Step 1: Create payment intent
const response = await fetch('/api/checkout/initial', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customer_info: {
      email: form.email,
      first_name: form.firstName,
      last_name: form.lastName,
      address_id: addressId,
      trash_day: form.trashDay
    },
    offer_id: currentOfferId,
    funnel_session_id: generateUUID(),
    funnel_id: FUNNEL_ID,
    variant: variantName
  })
});

const { clientSecret, sessionToken, stripePublishableKey } = await response.json();

// Step 2: Customer enters card
const stripe = Stripe(stripePublishableKey);
const { error, paymentIntent } = await stripe.confirmPayment({
  clientSecret,
  confirmParams: {
    return_url: `${window.location.origin}/funnel/next-step`
  },
  redirect: 'if_required'
});

if (error) {
  showError(error.message);
  return;
}

// Step 3: Confirm payment method saved (synchronously!)
const confirmResponse = await fetch('/api/checkout/confirm-payment-method', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    payment_intent_id: paymentIntent.id,
    session_token: sessionToken
  })
});

const confirmation = await confirmResponse.json();

if (confirmation.ready_for_upsells) {
  // Store session token for upsells
  sessionStorage.setItem('checkout_session', sessionToken);
  
  // Navigate to upsell page
  window.location.href = '/funnel/upsell';
}
```

### One-Click Upsell

```typescript
const sessionToken = sessionStorage.getItem('checkout_session');

document.getElementById('accept-upsell').addEventListener('click', async () => {
  // Show loading state
  button.disabled = true;
  button.textContent = 'Processing...';
  
  const response = await fetch('/api/checkout/one-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_token: sessionToken,
      offer_id: UPSELL_OFFER_ID
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    // Track conversion
    trackConversion(result.order_id, result.amount_charged);
    
    // Navigate to next step or thank you page
    window.location.href = '/thank-you';
  } else {
    showError('Payment failed. Please try again.');
    button.disabled = false;
    button.textContent = 'Accept Offer';
  }
});
```

## Error Handling

### Payment Failures

**Insufficient Funds**:
```rust
match pi_error.type_ {
    StripeErrorType::CardError => {
        if code == "insufficient_funds" {
            // Log, track, offer payment plan?
            return Err(CheckoutError::InsufficientFunds);
        }
    }
}
```

**Authentication Required**:
```rust
if pi.status == PaymentIntentStatus::RequiresAction {
    // For one-click purchases, this shouldn't happen
    // May indicate 3DS required - fall back to frontend confirmation
    return Ok(OneClickResult {
        success: false,
        requires_action: true,
        client_secret: Some(pi.client_secret),
    });
}
```

### Idempotency

Use idempotency keys for Stripe API calls:

```rust
let idempotency_key = format!("{}:{}:{}", 
    session_token, 
    offer_id, 
    chrono::Utc::now().timestamp()
);

params.idempotency_key = Some(&idempotency_key);
```

Store in `idempotency_keys` table to prevent duplicate charges.

## Analytics & Tracking

### Conversion Events

Track all purchases in `funnel_events`:

```sql
INSERT INTO funnel_events (
  session_id,
  customer_id,
  funnel_id,
  step_id,
  event_type,
  value_cents,
  offer_id,
  meta,
  created_at
) VALUES (
  $1, $2, $3, $4, 
  'purchase', 
  $5, $6,
  jsonb_build_object(
    'payment_intent_id', $7,
    'credits_applied', $8,
    'purchase_type', $9
  ),
  NOW()
);
```

### External Analytics

After successful purchase, trigger async:
- Google Ads conversion tracking
- Facebook Conversions API
- TikTok Events API
- GTM event firing

Use existing `analytics_events` infrastructure.

## Migration Plan

### Phase 1: Service Layer (Week 1)
1. Create `src/services/checkout/mod.rs`
2. Implement `initial_purchase()` method
3. Implement `confirm_payment_method_saved()` method
4. Implement `one_click_purchase()` method
5. Add unit tests

### Phase 2: API Endpoints (Week 1-2)
1. Create `/api/checkout/initial` endpoint
2. Create `/api/checkout/confirm-payment-method` endpoint
3. Create `/api/checkout/one-click` endpoint
4. Add integration tests
5. Update API documentation

### Phase 3: Frontend Integration (Week 2)
1. Create frontend checkout component
2. Implement Stripe Elements integration
3. Build one-click upsell UI
4. Add error handling
5. E2E testing

### Phase 4: Migration (Week 3)
1. Update existing funnels to use new endpoints
2. Migrate `initiate_checkout` to use CheckoutService
3. Migrate `create_payment_intent` + `confirm_payment` to new flow
4. Deprecate `process_checkout_payment` (keep for legacy)
5. Update documentation

### Phase 5: Monitoring & Optimization (Week 4)
1. Add performance monitoring
2. Set up error alerting
3. Optimize database queries
4. Load testing
5. Production rollout

## Testing Requirements

### Unit Tests

- [ ] Customer creation/retrieval
- [ ] Stripe customer linking
- [ ] PaymentIntent creation with setup_future_usage
- [ ] Payment method confirmation
- [ ] Credit issuance logic
- [ ] Credit application logic
- [ ] One-click charge (one-time)
- [ ] One-click subscription creation
- [ ] Error handling for all failure modes

### Integration Tests

- [ ] Full initial purchase flow
- [ ] Payment method confirmation flow
- [ ] One-click upsell flow
- [ ] Credit rollover flow (tripwire → subscription)
- [ ] Multiple upsells in sequence
- [ ] Session expiration handling
- [ ] Idempotency key enforcement

### E2E Tests (Cypress)

- [ ] Tripwire purchase with credit issuance
- [ ] Upsell acceptance with credit application
- [ ] Upsell decline (downsell path)
- [ ] Multiple upsells in funnel
- [ ] Payment failure handling
- [ ] Session timeout scenarios

## Performance Targets

- **Initial purchase**: < 1s API response
- **Payment method confirmation**: < 500ms
- **One-click purchase**: < 800ms
- **Database queries**: < 100ms per query
- **Stripe API calls**: < 500ms average

## Security Considerations

1. **Session tokens**: Use cryptographically secure UUIDs
2. **Payment method IDs**: Never expose in frontend
3. **Stripe keys**: Use environment variables
4. **Rate limiting**: Max 5 one-click purchases per session
5. **CORS**: Strict origin validation
6. **Input validation**: Zod schemas for all API inputs

## Monitoring & Alerts

### Metrics to Track

- One-click purchase success rate
- Payment method save rate
- Credit issuance/redemption rates
- Funnel conversion rates by step
- API latency (p50, p95, p99)
- Stripe API error rates

### Alerts

- One-click success rate < 95%
- Payment confirmation failures > 5%
- Credit application failures
- Session storage failures
- Stripe API errors

## Documentation Deliverables

- [ ] API endpoint documentation (OpenAPI/Swagger)
- [ ] Frontend integration guide
- [ ] Funnel setup guide
- [ ] Offer configuration guide
- [ ] Credit system documentation
- [ ] Troubleshooting guide
- [ ] Migration guide for existing funnels

## Success Criteria

1. ✅ One-click upsells working without card re-entry
2. ✅ < 100ms race condition window (vs ~5s with webhooks)
3. ✅ Credit rollover working correctly
4. ✅ Dual tracking (local + Stripe) maintained
5. ✅ Backward compatibility with existing checkouts
6. ✅ 95%+ one-click purchase success rate
7. ✅ All tests passing
8. ✅ Documentation complete
