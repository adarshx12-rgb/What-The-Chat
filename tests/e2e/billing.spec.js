const { test, expect, openStudio, setProfile, admin } = require('./fixtures');

async function signedInStudio(page){
  await openStudio(page);
  const email = `buyer-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'pw-123456!', email_confirm: true });
  if (error) throw error;
  await page.evaluate(async ([e]) => {
    const sb = WTCCredits.client();
    await sb.auth.signOut();
    await sb.auth.signInWithPassword({ email: e, password: 'pw-123456!' });
    await WTCCredits.refresh();
  }, [email]);
  return data.user.id;
}

test('upgrade opens Razorpay checkout with the created subscription', async ({ page }) => {
  await page.route('**/functions/v1/billing', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ subscription_id: 'sub_e2e', key_id: 'rzp_test_e2e' }),
  }));
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.Razorpay = function (o) { window.__rzp = o; this.open = function () {}; this.on = function () {}; };',
  }));
  const userId = await signedInStudio(page);
  await page.click('#creditsChip');
  await expect(page.locator('#planCard')).toBeVisible();
  await page.click('#currencyToggle [data-currency="USD"]');
  await expect(page.locator('#planPrice')).toContainText('$8');
  await page.click('#upgradeBtn');
  await expect.poll(() => page.evaluate(() => window.__rzp && window.__rzp.subscription_id)).toBe('sub_e2e');

  // Webhook lands (simulated), then Checkout reports success.
  await admin.from('profiles').update({ plan: 'pro', pro_until: new Date(Date.now() + 30 * 864e5).toISOString() }).eq('user_id', userId);
  await page.evaluate(() => window.__rzp.handler({ razorpay_subscription_id: 'sub_e2e' }));
  await expect(page.locator('#creditsChipText')).toHaveText('Pro');
  await expect(page.locator('#proSection')).toBeVisible();
  await expect(page.locator('#planCard')).toBeHidden();
});

test('visitors see the sign-in section, not the plan card', async ({ page }) => {
  await openStudio(page);
  await page.click('#creditsChip');
  await expect(page.locator('#planCard')).toBeHidden();
  await expect(page.locator('#signInSection')).toBeVisible();
});

test('cancel asks for confirmation, then calls billing cancel', async ({ page }) => {
  let body = null;
  await page.route('**/functions/v1/billing', (route) => {
    body = route.request().postDataJSON();
    route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  await signedInStudio(page);
  await setProfile(page, { plan: 'pro', pro_until: new Date(Date.now() + 30 * 864e5).toISOString() });
  await page.click('#creditsChip');
  await page.click('#cancelPlanBtn');
  expect(body).toBeNull();
  await expect(page.locator('#cancelPlanBtn')).toHaveText('Confirm cancel');
  await page.click('#cancelPlanBtn');
  await expect.poll(() => body && body.action).toBe('cancel');
  await expect(page.locator('#billingStatus')).toContainText('stays active until');
});

test('admins see Admin and no plan card or cancel button', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, {});
  const ent = await page.evaluate(() => WTCCredits.get());
  // Simulate an admin entitlement as the server would return it.
  await page.evaluate(() => { renderAccount(Object.assign({}, WTCCredits.get(), { admin: true, pro: true, isAnonymous: false, email: 'owner@example.com' })); });
  await expect(page.locator('#creditsChipText')).toHaveText('Admin');
  await page.click('#creditsChip');
  await expect(page.locator('#accountBalance')).toContainText('Admin');
  await expect(page.locator('#planCard')).toBeHidden();
  await expect(page.locator('#proSection')).toBeHidden();
  expect(ent).toBeTruthy();
});

test('yearly billing shows the yearly price and asks for a yearly subscription', async ({ page }) => {
  let body = null;
  await page.route('**/functions/v1/billing', (route) => {
    body = route.request().postDataJSON();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ subscription_id: 'sub_y', key_id: 'rzp_test_e2e' }) });
  });
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.Razorpay = function (o) { window.__rzp = o; this.open = function () {}; this.on = function () {}; };',
  }));
  await signedInStudio(page);
  await page.click('#creditsChip');
  await page.click('#currencyToggle [data-currency="INR"]');
  await page.click('#intervalToggle [data-interval="year"]');
  await expect(page.locator('#planPrice')).toContainText('₹3,999');
  await expect(page.locator('#planPrice')).toContainText('/ year');
  await page.click('#upgradeBtn');
  await expect.poll(() => body).toMatchObject({ action: 'create', currency: 'INR', interval: 'year' });
  await expect.poll(() => page.evaluate(() => window.__rzp && window.__rzp.description)).toBe('Pro, yearly');
});

test('buying a credit pack opens Checkout with the order and waits for the credits', async ({ page }) => {
  let body = null;
  await page.route('**/functions/v1/billing', (route) => {
    body = route.request().postDataJSON();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ order_id: 'order_e2e', amount: 299, currency: 'USD', key_id: 'rzp_test_e2e' }) });
  });
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.Razorpay = function (o) { window.__rzp = o; this.open = function () {}; this.on = function () {}; };',
  }));
  const userId = await signedInStudio(page);
  await page.click('#creditsChip');
  await page.click('#currencyToggle [data-currency="USD"]');
  await expect(page.locator('#packCard')).toBeVisible();
  await expect(page.locator('#packTitle')).toHaveText('100 credits · $2.99');
  await page.click('#packBtn');
  await expect.poll(() => body).toMatchObject({ action: 'pack', currency: 'USD' });
  await expect.poll(() => page.evaluate(() => window.__rzp && window.__rzp.order_id)).toBe('order_e2e');

  // Webhook lands (simulated), then Checkout reports success.
  const before = await page.evaluate(() => WTCCredits.get().credits);
  await admin.from('profiles').update({ credits: before + 100 }).eq('user_id', userId);
  await page.evaluate(() => window.__rzp.handler({ razorpay_order_id: 'order_e2e' }));
  await expect(page.locator('#billingStatus')).toHaveText('Credits added.');
  await expect(page.locator('#creditsChipText')).toHaveText((before + 100) + ' credits');
});

test('delete account asks twice, calls billing, then starts a fresh visitor', async ({ page }) => {
  let body = null;
  await page.route('**/functions/v1/billing', (route) => {
    body = route.request().postDataJSON();
    route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  const userId = await signedInStudio(page);
  await page.click('#creditsChip');
  await page.click('#deleteAccountBtn');
  expect(body).toBeNull();
  await expect(page.locator('#deleteAccountBtn')).toHaveText('Yes, delete my account forever');
  await page.click('#deleteAccountBtn');
  await expect.poll(() => body).toEqual({ action: 'delete_account', confirm: 'DELETE' });
  await expect(page.locator('#toastRegion')).toContainText('Your account was deleted.');
  await expect.poll(() => page.evaluate(() => WTCCredits.get().isAnonymous)).toBe(true);
  expect(await page.evaluate(() => WTCCredits.userId())).not.toBe(userId);
});
