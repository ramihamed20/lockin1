import { useEffect, useState } from "react";
import { Icon } from "../../lib/icons.jsx";
import { authApi } from "../../lib/api.js";
import { assets, quotes } from "../../lib/constants.js";
import { assetPath } from "../../lib/utils.js";
import { AccountFieldErrors, AccountFormAlert } from "../account/AccountFormErrors.jsx";

export function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [lang, setLang] = useState("ar");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", remember: true, acceptPolicies: false, year: "Dental Medicine - University of Tripoli (1st Year)" });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setError(null);
    setMessage("");
    setVerificationPending(false);
    setShowPwd(false);
    setShowConfirm(false);
  }, [mode]);

  useEffect(() => {
    const timer = window.setInterval(() => setQuoteIdx((i) => (i + 1) % quotes.length), 6000);
    return () => window.clearInterval(timer);
  }, []);

  const t = {
    ar: {
      brandBadge: "منصة الدراسة",
      loginTitle: "مرحباً بك مجدداً!",
      loginSubtitle: "سجّل الدخول لمتابعة رحلتك التعليمية في طب الأسنان.",
      signupTitle: "إنشاء حساب جديد",
      signupSubtitle: "ابدأ رحلتك التعليمية اليوم مع منصة Lock-in.",
      forgotTitle: "إعادة تعيين كلمة المرور",
      forgotSubtitle: "أدخل بريدك الإلكتروني لتلقي رابط إعادة تعيين كلمة المرور.",
      
      fullName: "الاسم الكامل",
      fullNamePlaceholder: "أدخل اسمك الكامل",
      specialization: "التخصص والسنة الدراسية",
      email: "البريد الإلكتروني",
      password: "كلمة المرور",
      passwordPlaceholder: "أدخل كلمة المرور الخاصة بك",
      confirmPassword: "تأكيد كلمة المرور",
      confirmPasswordPlaceholder: "أعد كتابة كلمة المرور للتأكيد",
      rememberMe: "تذكرني",
      forgotPassword: "نسيت كلمة المرور؟",
      submitSignUp: "إنشاء حساب جديد",
      submitForgot: "إرسال رابط إعادة التعيين",
      submitLogIn: "تسجيل الدخول",
      pleaseWait: "يرجى الانتظار...",
      demoAccount: "الدخول بحساب تجريبي",
      
      alreadyHaveAccount: "لديك حساب بالفعل؟ ",
      dontHaveAccount: "ليس لديك حساب؟ ",
      signUpFree: "سجّل مجاناً",
      logIn: "تسجيل الدخول",
      backToLogin: "العودة لتسجيل الدخول",
      
      forgotSuccess: "إذا كان هذا البريد الإلكتروني مسجلاً، فسيتم إرسال رابط إعادة تعيين كلمة المرور إليك.",
      pwdMismatch: "كلمتا المرور غير متطابقتين.",
      
      opt1: "طب الأسنان - جامعة طرابلس (السنة الأولى)",
      opt2: "طب الأسنان - جامعة طرابلس (السنة الثانية)",
      opt3: "طب الأسنان - جامعة الزاوية (السنة الثانية)",
      opt4: "طب الأسنان - جامعة بنغازي (السنة الثانية)",
      opt5: "تمهيدي العلوم الطبية - جامعة طرابلس"
    },
    en: {
      brandBadge: "Study Platform",
      loginTitle: "Welcome back!",
      loginSubtitle: "Log in to continue your dental learning journey.",
      signupTitle: "Create account",
      signupSubtitle: "Start your Lock-in learning journey today.",
      forgotTitle: "Reset password",
      forgotSubtitle: "Enter your email to receive a reset link.",
      
      fullName: "Full name",
      fullNamePlaceholder: "Enter your full name",
      specialization: "Specialization & Study Year",
      email: "Email address",
      password: "Password",
      passwordPlaceholder: "Enter your password",
      confirmPassword: "Confirm password",
      confirmPasswordPlaceholder: "Confirm your password",
      rememberMe: "Remember me",
      forgotPassword: "Forgot password?",
      submitSignUp: "Create Account",
      submitForgot: "Send Reset Link",
      submitLogIn: "Log In",
      pleaseWait: "Please wait...",
      demoAccount: "Use demo account",
      
      alreadyHaveAccount: "Already have an account? ",
      dontHaveAccount: "Don't have an account? ",
      signUpFree: "Sign up free",
      logIn: "Log in",
      backToLogin: "Back to login",
      
      forgotSuccess: "If this email exists, a reset link will be sent in the production version.",
      pwdMismatch: "Passwords do not match.",
      
      opt1: "Dental Medicine - University of Tripoli (1st Year)",
      opt2: "Dental Medicine - University of Tripoli (2nd Year)",
      opt3: "Dental Medicine - University of Zawiya (2nd Year)",
      opt4: "Dental Medicine - University of Benghazi (2nd Year)",
      opt5: "Introductory Medical Sciences - University of Tripoli"
    }
  };

  const copy = {
    login: [t[lang].loginTitle, t[lang].loginSubtitle],
    signup: [t[lang].signupTitle, t[lang].signupSubtitle],
    forgot: [t[lang].forgotTitle, t[lang].forgotSubtitle]
  }[mode];

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setMessage("");

    if (mode === "forgot") {
      setLoading(true);
      try {
        await authApi.requestPasswordReset(form.email);
        setMessage(t[lang].forgotSuccess);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (mode === "signup" && form.password !== form.confirm) {
      setError(new Error(t[lang].pwdMismatch));
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        await authApi.register({
          fullName: form.name,
          email: form.email,
          password: form.password,
          passwordConfirm: form.confirm,
          preferredLanguage: lang,
          acceptPolicies: form.acceptPolicies
        });
        setMessage("Account created. Check your email to verify it before signing in.");
        setVerificationPending(true);
      } else {
        const result = await authApi.login({ email: form.email, password: form.password, remember: form.remember });
        onAuthed(result.user);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`auth-page auth-${mode}`}>
      <div className="auth-bg-orbs" aria-hidden="true">
        <span className="auth-orb auth-orb-1" />
        <span className="auth-orb auth-orb-2" />
        <span className="auth-orb auth-orb-3" />
      </div>

      <section className="auth-card" aria-label="Lock-in authentication">
        <div className="auth-panel">
          <div className="auth-panel-inner" style={{ direction: lang === "ar" ? "rtl" : "ltr" }}>
            <div className="auth-brand" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="auth-brand-logo">
                  <span className="auth-brand-mark">
                    <img src={assetPath("/assets/logo.jpg")} alt="Lock-in Logo" className="brand-logo-img" />
                  </span>
                </div>
                <span className="auth-brand-badge">{t[lang].brandBadge}</span>
              </div>
              <button
                type="button"
                className="btn-lang-toggle"
                onClick={() => setLang(lang === "ar" ? "en" : "ar")}
                style={{
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "20px",
                  padding: "6px 14px",
                  color: "var(--text)",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.2s ease"
                }}
              >
                <Icon name="globe" size={14} />
                {lang === "ar" ? "English" : "عربي"}
              </button>
            </div>

            <div className="auth-header" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
              <h1 className="auth-title">{copy[0]}</h1>
              <p className="auth-subtitle">{copy[1]}</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              {mode === "signup" && (
                <>
                  <div className="auth-field-group" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
                    <label className="auth-field-label" htmlFor="auth-name">{t[lang].fullName}</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon" aria-hidden="true" style={{ left: lang === "ar" ? "auto" : "12px", right: lang === "ar" ? "12px" : "auto" }}>
                        <Icon name="user" size={18} />
                      </span>
                      <input 
                        id="auth-name" 
                        type="text" 
                        placeholder={t[lang].fullNamePlaceholder} 
                        value={form.name} 
                        onChange={(e) => setForm({ ...form, name: e.target.value })} 
                        required 
                        style={{
                          paddingLeft: lang === "ar" ? "12px" : "38px",
                          paddingRight: lang === "ar" ? "38px" : "12px"
                        }}
                      />
                    </div>
                    <AccountFieldErrors error={error} field="full_name" />
                  </div>

                  <div className="auth-field-group" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
                    <label className="auth-field-label" htmlFor="auth-year">{t[lang].specialization}</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon" aria-hidden="true" style={{ left: lang === "ar" ? "auto" : "12px", right: lang === "ar" ? "12px" : "auto" }}>
                        <Icon name="book-open" size={18} />
                      </span>
                      <select
                        id="auth-year"
                        value={form.year}
                        onChange={(e) => setForm({ ...form, year: e.target.value })}
                        required
                        style={{
                          width: "100%",
                          paddingLeft: lang === "ar" ? "12px" : "38px",
                          paddingRight: lang === "ar" ? "38px" : "12px",
                          paddingTop: "10px",
                          paddingBottom: "10px",
                          background: "transparent",
                          border: "none",
                          color: "var(--text)",
                          fontSize: "14px",
                          outline: "none",
                          cursor: "pointer",
                          fontFamily: "inherit"
                        }}
                      >
                        <option style={{ background: "var(--bg-2, #0c1222)", color: "var(--text)" }} value="Dental Medicine - University of Tripoli (1st Year)">{t[lang].opt1}</option>
                        <option style={{ background: "var(--bg-2, #0c1222)", color: "var(--text)" }} value="Dental Medicine - University of Tripoli (2nd Year)">{t[lang].opt2}</option>
                        <option style={{ background: "var(--bg-2, #0c1222)", color: "var(--text)" }} value="Dental Medicine - University of Zawiya (2nd Year)">{t[lang].opt3}</option>
                        <option style={{ background: "var(--bg-2, #0c1222)", color: "var(--text)" }} value="Dental Medicine - University of Benghazi (2nd Year)">{t[lang].opt4}</option>
                        <option style={{ background: "var(--bg-2, #0c1222)", color: "var(--text)" }} value="Introductory Medical Sciences - University of Tripoli">{t[lang].opt5}</option>
                      </select>
                    </div>
                    <p className="form-hint">This study-profile choice is not stored by the current account API.</p>
                  </div>
                </>
              )}

              <div className="auth-field-group" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
                <label className="auth-field-label" htmlFor="auth-email">{t[lang].email}</label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon" aria-hidden="true" style={{ left: lang === "ar" ? "auto" : "12px", right: lang === "ar" ? "12px" : "auto" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  </span>
                  <input 
                    id="auth-email" 
                    type="email" 
                    placeholder="you@example.com" 
                    value={form.email} 
                    onChange={(e) => setForm({ ...form, email: e.target.value })} 
                    required 
                    style={{
                      paddingLeft: lang === "ar" ? "12px" : "38px",
                      paddingRight: lang === "ar" ? "38px" : "12px"
                    }}
                  />
                </div>
                <AccountFieldErrors error={error} field="email" />
              </div>

              {mode !== "forgot" && (
                <div className="auth-field-group" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
                  <label className="auth-field-label" htmlFor="auth-password">{t[lang].password}</label>
                  <div className="auth-input-wrap">
                    <span className="auth-input-icon" aria-hidden="true" style={{ left: lang === "ar" ? "auto" : "12px", right: lang === "ar" ? "12px" : "auto" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input 
                      id="auth-password" 
                      type={showPwd ? "text" : "password"} 
                      placeholder={t[lang].passwordPlaceholder} 
                      value={form.password} 
                      onChange={(e) => setForm({ ...form, password: e.target.value })} 
                      required 
                      style={{
                        paddingLeft: lang === "ar" ? "12px" : "38px",
                        paddingRight: lang === "ar" ? "38px" : "12px"
                      }}
                    />
                    <button 
                      type="button" 
                      className="auth-input-toggle" 
                      onClick={() => setShowPwd(!showPwd)} 
                      aria-label={showPwd ? "Hide password" : "Show password"}
                      style={{
                        left: lang === "ar" ? "10px" : "auto",
                        right: lang === "ar" ? "auto" : "10px"
                      }}
                    >
                      <Icon name={showPwd ? "eye-off" : "eye"} size={17} />
                    </button>
                  </div>
                  <AccountFieldErrors error={error} field="password" />
                </div>
              )}

              {mode === "signup" && (
                <div className="auth-field-group" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
                  <label className="auth-field-label" htmlFor="auth-confirm">{t[lang].confirmPassword}</label>
                  <div className="auth-input-wrap">
                    <span className="auth-input-icon" aria-hidden="true" style={{ left: lang === "ar" ? "auto" : "12px", right: lang === "ar" ? "12px" : "auto" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    </span>
                    <input 
                      id="auth-confirm" 
                      type={showConfirm ? "text" : "password"} 
                      placeholder={t[lang].confirmPasswordPlaceholder} 
                      value={form.confirm} 
                      onChange={(e) => setForm({ ...form, confirm: e.target.value })} 
                      required 
                      style={{
                        paddingLeft: lang === "ar" ? "12px" : "38px",
                        paddingRight: lang === "ar" ? "38px" : "12px"
                      }}
                    />
                    <button 
                      type="button" 
                      className="auth-input-toggle" 
                      onClick={() => setShowConfirm(!showConfirm)} 
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      style={{
                        left: lang === "ar" ? "10px" : "auto",
                        right: lang === "ar" ? "auto" : "10px"
                      }}
                    >
                      <Icon name={showConfirm ? "eye-off" : "eye"} size={17} />
                    </button>
                  </div>
                  <AccountFieldErrors error={error} field="password_confirm" />
                </div>
              )}

              {mode === "signup" && (
                <div className="auth-options-row">
                  <label className="auth-check-row">
                    <input
                      type="checkbox"
                      checked={form.acceptPolicies}
                      onChange={(event) => setForm({ ...form, acceptPolicies: event.target.checked })}
                      required
                    />
                    <span>{lang === "ar" ? "أوافق على سياسات المنصة" : "I agree to the platform policies"}</span>
                  </label>
                  <AccountFieldErrors error={error} field="accept_policies" />
                </div>
              )}

              {mode === "login" && (
                <div className="auth-options-row">
                  <label className="auth-check-row">
                    <input type="checkbox" checked={form.remember} onChange={(event) => setForm({ ...form, remember: event.target.checked })} />
                    <span>{t[lang].rememberMe}</span>
                  </label>
                  <button className="auth-forgot-link" type="button" onClick={() => setMode("forgot")}>
                    {t[lang].forgotPassword}
                  </button>
                </div>
              )}

              <AccountFormAlert error={error} message={message} />
              {mode === "signup" && verificationPending && (
                <button
                  className="auth-forgot-link"
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    setError(null);
                    setMessage("");
                    setLoading(true);
                    try {
                      await authApi.resendVerification(form.email);
                      setMessage("If this account needs verification, a new email has been sent.");
                    } catch (err) {
                      setError(err);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Resend verification email
                </button>
              )}

              <button className="auth-submit-btn" type="submit" disabled={loading}>
                {loading && <span className="auth-spinner" aria-hidden="true" />}
                {loading ? t[lang].pleaseWait : mode === "signup" ? t[lang].submitSignUp : mode === "forgot" ? t[lang].submitForgot : t[lang].submitLogIn}
                {!loading && <Icon name="chevron-right" size={18} style={{ transform: lang === "ar" ? "rotate(180deg)" : "none" }} />}
              </button>

              {mode !== "forgot" && (
                <button className="auth-demo-btn" type="button" onClick={() => setForm({ ...form, email: "student@lockin.local", password: "Student123!" })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  {t[lang].demoAccount}
                </button>
              )}
            </form>

            <div className="auth-switch">
              {mode === "signup" && (
                <p>{t[lang].alreadyHaveAccount}<button className="auth-switch-link" onClick={() => setMode("login")}>{t[lang].logIn}</button></p>
              )}
              {mode === "forgot" && (
                <p><button className="auth-switch-link" onClick={() => setMode("login")}><Icon name={lang === "ar" ? "chevron-right" : "chevron-left"} size={16} /> {t[lang].backToLogin}</button></p>
              )}
              {mode === "login" && (
                <p>{t[lang].dontHaveAccount}<button className="auth-switch-link" onClick={() => setMode("signup")}>{t[lang].signUpFree}</button></p>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
