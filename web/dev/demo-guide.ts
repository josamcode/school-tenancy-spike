import { seedUsers } from './seed-users';

// Development only. The demo guide is the sign-in page: one group per proof,
// and in each the seed users to sign in as and the page each one lands on.
// The API cannot list users, and will not name a school that is not the
// caller's, so those ids are written here. A test compares them with
// db/seed.ts.
export interface GuideText {
  ar: string;
  en: string;
}

export interface GuideEntry {
  id: string;
  userId: string;
  email: string;
  schoolId: string;
  // Where the user lands, after the language.
  path: string;
  shows: GuideText;
}

export interface GuideGroup {
  id: string;
  title: GuideText;
  entries: GuideEntry[];
}

const yasmin = 'de700000-0000-4000-8000-000000000001';
const rayhan = 'de700000-0000-4000-8000-000000000002';
// The demo users have no access to this one.
const sindyan = 'de700000-0000-4000-8000-000000000003';
const ghadeer = 'de700000-0000-4000-8000-000000000004';
const murooj = 'de700000-0000-4000-8000-000000000005';

const principal = {
  userId: 'de700000-0000-4000-8000-0000000000a1',
  email: 'principal@alyasmin.test',
};
const teacher = {
  userId: 'de700000-0000-4000-8000-0000000000a2',
  email: 'teacher@alyasmin.test',
};
const groupAdmin = {
  userId: 'de700000-0000-4000-8000-0000000000a3',
  email: 'admin@yasmin-group.test',
};

// What each invoice demo shows, in Arabic. The English is in seed-users.ts.
const invoicesInArabic = [
  'دبي: التقويم المحسوب، واسم طالب بالعربية',
  'الرياض: اللحظة نفسها في دبي، بتاريخ يسبقها بيوم',
  'مسقط: أُعلن شوال 1446 بعد الحساب بيوم',
  'المنامة: الدينار بثلاث خانات عشرية، وأُعلن شوال 1447 قبل الحساب بيوم',
  'موظف في دبي: لا يملك صلاحية المالية فلا يرى الفواتير',
  'فاتورة بلا بيان ولا تاريخ استحقاق ولا دولة',
];

export const demoGuide: GuideGroup[] = [
  {
    id: 'isolation',
    title: { ar: 'عزل بيانات المدارس', en: 'Tenant isolation' },
    entries: [
      {
        id: 'isolation',
        ...principal,
        schoolId: yasmin,
        path: `/schools/${yasmin}/students?try=${sindyan}`,
        shows: {
          ar: 'مدير أربع مدارس: يتنقل بينها ويرى طلاب كل مدرسة وحدها. مدرسة السنديان ليست من مدارسه، والخادم يرفض فتحها.',
          en: 'The principal of four schools: switch between them and see only that school’s students. Al Sindyan is not theirs, and the server refuses to open it.',
        },
      },
    ],
  },
  {
    id: 'modules',
    title: { ar: 'الخدمات المفعّلة لكل مدرسة', en: 'Modules per school' },
    entries: [
      {
        id: 'modules-on',
        ...principal,
        schoolId: yasmin,
        path: `/schools/${yasmin}`,
        shows: {
          ar: 'مدرسة الياسمين: خدمة المالية مفعّلة، فالفواتير ودفتر الأستاذ مسموحان.',
          en: 'Al Yasmin: finance is on, so invoices and the ledger are allowed.',
        },
      },
      {
        id: 'modules-off',
        ...principal,
        schoolId: rayhan,
        path: `/schools/${rayhan}`,
        shows: {
          ar: 'مدرسة الريحان: خدمة المالية غير مفعّلة، فيرفض الخادم صفحاتها وتبقى صفحة الطلاب تعمل.',
          en: 'Al Rayhan: finance is off, so the server refuses its pages while students still work.',
        },
      },
    ],
  },
  {
    id: 'permissions',
    title: { ar: 'الصلاحيات', en: 'Permissions' },
    entries: [
      {
        id: 'permissions-admin',
        ...principal,
        schoolId: yasmin,
        path: `/schools/${yasmin}`,
        shows: {
          ar: 'مدير المدرسة: كل الصفحات مسموحة.',
          en: 'School admin: every page is allowed.',
        },
      },
      {
        id: 'permissions-staff',
        ...teacher,
        schoolId: yasmin,
        path: `/schools/${yasmin}`,
        shows: {
          ar: 'موظف في المدرسة نفسها: يرى الطلاب فقط، والخادم يرفض الباقي.',
          en: 'Staff in the same school: students only, and the server refuses the rest.',
        },
      },
      {
        id: 'permissions-group-admin',
        ...groupAdmin,
        schoolId: yasmin,
        path: `/schools/${yasmin}`,
        shows: {
          ar: 'مدير المجموعة: لا عضوية له، وله صلاحية ممنوحة على المالية في الياسمين فقط. الريحان من مجموعته ومع ذلك يرفضها الخادم.',
          en: 'Group admin: no membership, and a granted permission on finance in Al Yasmin only. Al Rayhan is in the group, and the server still refuses it.',
        },
      },
    ],
  },
  {
    id: 'ledger',
    title: { ar: 'دفتر الأستاذ', en: 'Ledger' },
    entries: [
      {
        id: 'ledger',
        ...principal,
        schoolId: yasmin,
        path: `/schools/${yasmin}/ledger`,
        shows: {
          ar: 'دفتر الأستاذ لمدرسة الياسمين: القيود متوازنة في كل عملة، وأرصدة الطلاب، ومراكز العملات الأجنبية، والفترات المقفلة.',
          en: 'The ledger of Al Yasmin: entries balance in every currency, student balances, foreign currency positions and locked periods.',
        },
      },
    ],
  },
  {
    id: 'events',
    title: { ar: 'من قبول الطلب إلى أثره', en: 'Events, end to end' },
    entries: [
      {
        id: 'events-fee',
        ...principal,
        schoolId: ghadeer,
        path: `/schools/${ghadeer}/admissions`,
        shows: {
          ar: 'مدرسة الغدير، والمالية مفعّلة: اقبل طلبًا وتابعه حتى تُقيَّد رسوم التسجيل على الطالب.',
          en: 'Al Ghadeer, with finance on: accept an application and follow it to the registration fee on the student.',
        },
      },
      {
        id: 'events-webhook',
        ...principal,
        schoolId: murooj,
        path: `/schools/${murooj}/admissions`,
        shows: {
          ar: 'مدرسة المروج، والمالية غير مفعّلة: اقبل طلبًا وتابعه حتى يستلمه نظام المدرسة بتوقيع صحيح.',
          en: 'Al Murooj, with finance off: accept an application and follow it to the school’s own system, signature verified.',
        },
      },
    ],
  },
  {
    id: 'invoices',
    title: {
      ar: 'الفواتير بالعربية والتاريخ الهجري',
      en: 'Invoices in Arabic, with Hijri dates',
    },
    entries: seedUsers.map((user, index) => ({
      id: `invoices-${index + 1}`,
      userId: user.userId,
      email: user.email,
      schoolId: user.schoolId,
      path: `/schools/${user.schoolId}/invoices`,
      shows: { ar: invoicesInArabic[index], en: user.shows },
    })),
  },
];
