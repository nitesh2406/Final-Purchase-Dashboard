// =================================================================================
// AUTHENTICATION & CORE HELPERS
// =================================================================================
//
// Script Properties (Amazon/Shopify/EasyEcom/Flipkart credentials) are already
// set from a prior run of the seeding function that used to live here. Do NOT
// put credential literals back in this file.
//
// To (re)seed a property after rotating a secret in the provider's dashboard,
// run this from the Apps Script editor's "Run" button with the value pasted in
// only for that one call, then delete the literal again immediately:
//
//   function _setOneCredential() {
//     PropertiesService.getScriptProperties().setProperty('KEY_NAME', 'paste-value-here');
//   }
//
// Keys in use: AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN,
// MARKETPLACE_ID, SHOPIFY_SHOP_NAME, SHOPIFY_ACCESS_TOKEN, EASY_ECOM_API_KEY,
// EASY_ECOM_EMAIL, EASY_ECOM_PASSWORD, EASY_ECOM_LOCATION_KEY, ZOHO_CLIENT_SECRET,
// ZOHO_REFRESH_TOKEN.
//
// FLIPKART_APP_ID / FLIPKART_SECRET are stale — getFlipkartAccessToken() (the
// only reader) has been removed. The properties themselves still live in this
// project's Script Properties store (Project Settings in the Apps Script
// editor); delete them there manually whenever convenient, code changes here
// can't reach them.

function _verifyCredentialsPresent() {
  const props = PropertiesService.getScriptProperties();
  const keys = [
    'AMAZON_CLIENT_ID', 'AMAZON_CLIENT_SECRET', 'AMAZON_REFRESH_TOKEN', 'MARKETPLACE_ID',
    'SHOPIFY_SHOP_NAME', 'SHOPIFY_ACCESS_TOKEN',
    'EASY_ECOM_API_KEY', 'EASY_ECOM_EMAIL', 'EASY_ECOM_PASSWORD', 'EASY_ECOM_LOCATION_KEY',
    'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'
  ];
  const missing = keys.filter(k => !props.getProperty(k));
  if (missing.length) {
    Logger.log('MISSING properties: ' + missing.join(', '));
  } else {
    Logger.log('All credential properties present.');
  }
  return missing;
}
