/* Where the accounts live.

   Both values below are public by design: the publishable key identifies the
   project, it does not grant access. Every table is behind row-level security
   keyed to auth.uid(), so this key alone reads nothing. It is safe in a public
   repo and safe in the browser.

   Leave SUPABASE_URL empty to turn accounts off entirely — the dashboard then
   runs exactly as it always has: localStorage, IndexedDB, no backend, no
   signup, deployable to GitHub Pages. Accounts are additive, never required. */
window.ANSWER_SPACE_CONFIG = {
  SUPABASE_URL:  "https://uzfshuoycqgavcelfnbv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_BF5cjzwr6syRL2EK8MKP1w_8GYLziJc",
};
