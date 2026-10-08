// The owner's published rules, in both languages. The refund window stated here
// is the one the server enforces (REFUND_WINDOW in backend/apps/refunds/services.py);
// change both together.
export const TERMS = {
  ar: {
    updated: "آخر تحديث: 8 أكتوبر 2026",
    sections: [
      {
        id: "account",
        title: "حسابك شخصي",
        items: [
          "الحساب لشخص واحد فقط. يُمنع مشاركة الحساب أو بيانات الدخول مع أي شخص آخر أو استخدامه من أكثر من مستخدم.",
          "عند اكتشاف مشاركة الحساب يحق لنا إيقافه أو حذفه نهائياً دون استرداد أي مبلغ.",
          "أنت مسؤول عن الحفاظ على سرية كلمة المرور الخاصة بك."
        ]
      },
      {
        id: "payment",
        title: "الاشتراك والدفع",
        items: [
          "الدفع يتم ببطاقات شحن ليبيانا، ويبدأ الوصول فور الإرسال بينما يتم التحقق من البطاقات.",
          "البطاقة غير الصالحة أو المستخدمة مسبقاً تؤدي إلى رفض الدفع وإلغاء الوصول المرتبط به.",
          "تنتهي كل خطة في تاريخها المحدد مهما كان تاريخ الشراء."
        ]
      },
      {
        id: "installments",
        title: "الأقساط",
        items: [
          "تحصل على الفترة كاملة بعد دفع القسط الأول، وكل قسط بعده يُستحق بعد شهر من القسط السابق.",
          "إذا لم يُدفع القسط في موعده يُعلَّق الوصول. الدفع خلال يومين يعيد الوصول فوراً، وبعدها يتوقف الحساب حتى يتم التحقق من الدفع."
        ]
      },
      {
        id: "refunds",
        title: "سياسة الاسترداد",
        items: [
          "يمكنك طلب استرداد المبلغ المدفوع خلال أول 15 يوماً من بداية الاشتراك.",
          "في الاشتراك بالأقساط تُحسب الـ15 يوماً من تاريخ القسط الأول.",
          "بعد مرور 15 يوماً لا يوجد أي استرداد.",
          "عند الاسترداد ينتهي الاشتراك ويتوقف الوصول.",
          "لا يوجد استرداد للحسابات الموقوفة أو المحذوفة بسبب مخالفة هذه الشروط.",
          "لطلب الاسترداد تواصل معنا خلال المدة المحددة."
        ]
      },
      {
        id: "changes",
        title: "تعديل الشروط",
        items: ["قد نقوم بتحديث هذه الشروط، وسنُعلمك بأي تغيير مهم داخل المنصة."]
      }
    ]
  },
  en: {
    updated: "Last updated: 8 October 2026",
    sections: [
      {
        id: "account",
        title: "Your account is personal",
        items: [
          "An account belongs to one person. Sharing the account or its sign-in details with anyone else, or using it from more than one person, is not allowed.",
          "If we find an account being shared, we may suspend or permanently delete it without any refund.",
          "You are responsible for keeping your password private."
        ]
      },
      {
        id: "payment",
        title: "Subscription and payment",
        items: [
          "Payment is made with Libyana recharge cards. Access starts as soon as you submit while the cards are verified.",
          "An invalid or already-used card means the payment is rejected and the access it opened is removed.",
          "Every plan ends on its stated date, whatever day it was bought."
        ]
      },
      {
        id: "installments",
        title: "Installments",
        items: [
          "You get the whole term after the first installment; each later installment is due a month after the previous one.",
          "If an installment is not paid on time, access is paused. Paying within two days restores it immediately; after that, access stops until the payment is verified."
        ]
      },
      {
        id: "refunds",
        title: "Refund policy",
        items: [
          "You can ask for a refund of what you paid within the first 15 days of your subscription.",
          "For a subscription paid in installments, the 15 days count from the first installment.",
          "After 15 days there are no refunds.",
          "A refund ends the subscription and its access.",
          "Accounts suspended or deleted for breaking these terms are not refunded.",
          "To request a refund, contact us within that period."
        ]
      },
      {
        id: "changes",
        title: "Changes to these terms",
        items: ["We may update these terms and will tell you about any important change inside the platform."]
      }
    ]
  }
};
