/* Public Supabase settings. The anon key is designed to be public: Row Level
 * Security in supabase/migrations decides what it can do. Never put the
 * service_role key or Razorpay secrets in this file. */
window.WTC_CONFIG = {
  supabaseUrl: 'https://qmlhbpwbhcdefwbixcrh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbGhicHdiaGNkZWZ3Yml4Y3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjE0MDYsImV4cCI6MjEwNjc5NzQwNn0.Vn-Qk4-_wGJoqdGQ15SzHrG38uSxydEpbF7SEknG3RA',
  // Display prices. The amounts actually charged live in Razorpay (plans) and
  // supabase/functions/_shared/razorpay.ts (CREDIT_PACK); keep them in sync.
  prices: {
    INR: { month: '₹499', year: '₹3,999', pack: '₹149' },
    USD: { month: '$8', year: '$64', pack: '$2.99' },
  },
  packCredits: 100,
};
