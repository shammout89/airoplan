import { taskMode } from './task-approval';

export type LifecycleStageStatus = 'done' | 'active' | 'pending' | 'blocked';

export interface LifecycleStage {
  key: 'prepare' | 'plan_approval' | 'execute_record' | 'execute_approval';
  step: number;
  title: string;
  status: LifecycleStageStatus;
  detail: string;
}

export interface TaskWorkflowGuide {
  stages: LifecycleStage[];
  summary: string;
  waitingOn: string;
  nextStep: string;
  executionBadgeLabel: string;
  executionGuidance: string | null;
  canCurrentUserActInExecution: boolean;
}

export interface TaskGuideTaskShape {
  name?: string;
  status?: string;
  reviewState?: string;
  programRevisionId?: string | null;
  schedule?: unknown;
  nextTaskId?: string | null;
  taskApproval?: {
    mode?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TaskGuideAccomplishmentShape {
  state?: string | null;
  modified_by?: string | null;
  submitted_by?: string | null;
  reviewed_by?: string | null;
  [key: string]: unknown;
}

export interface TaskGuideProgramShape {
  state?: string | null;
  [key: string]: unknown;
}

export interface TaskGuideInput {
  taskData?: TaskGuideTaskShape | null;
  accomplishment?: TaskGuideAccomplishmentShape | null;
  program?: TaskGuideProgramShape | null;
  session?: {
    userId?: string;
    role?: string;
    permissions?: string[];
  } | null;
}

function hasPerm(permissions: string[] | undefined, perm: string): boolean {
  return Array.isArray(permissions) && permissions.includes(perm);
}

export function computeTaskWorkflowGuide({
  taskData,
  accomplishment,
  program,
  session,
}: TaskGuideInput): TaskWorkflowGuide {
  const t: TaskGuideTaskShape = taskData || {};
  const permissions = session?.permissions || [];
  const userId = session?.userId || '';
  const role = session?.role || '';
  const reviewState = t.reviewState || 'draft';
  const mode = taskMode(t);
  const needsInit = Boolean(t.programRevisionId && !t.schedule && !['closed', 'withdrawn'].includes(t.status));
  const isClosed = t.status === 'closed';
  const isWithdrawn = t.status === 'withdrawn';
  const execState = accomplishment?.state || null;

  const canRecord = hasPerm(permissions, 'record_execution');
  const canEditTask = hasPerm(permissions, 'edit_task');
  const canSubmit = hasPerm(permissions, 'submit');
  const canReview = hasPerm(permissions, 'review');
  const canApprove = hasPerm(permissions, 'approve');

  // Stage statuses & guidance
  let stage1: LifecycleStage = {
    key: 'prepare',
    step: 1,
    title: 'إعداد وتخطيط المهمة',
    status: 'done',
    detail: t.schedule ? 'الاستحقاق الآلي مهيأ' : 'بيانات التخطيط جاهزة',
  };
  let stage2: LifecycleStage = {
    key: 'plan_approval',
    step: 2,
    title: 'اعتماد التخطيط',
    status: reviewState === 'approved' ? 'done' : 'pending',
    detail: reviewState === 'approved' ? 'معتمد للتخطيط' : 'بانتظار الاعتماد',
  };
  let stage3: LifecycleStage = {
    key: 'execute_record',
    step: 3,
    title: 'توثيق وإرسال التنفيذ',
    status: 'pending',
    detail: 'بعد اعتماد التخطيط',
  };
  let stage4: LifecycleStage = {
    key: 'execute_approval',
    step: 4,
    title: 'مراجعة واعتماد التنفيذ',
    status: 'pending',
    detail: 'توليد المرة التالية / الإغلاق',
  };

  let summary = '';
  let waitingOn = '';
  let nextStep = '';
  let executionBadgeLabel = 'التنفيذ: ينتظر اعتماد التخطيط';
  let executionGuidance: string | null = null;
  let canCurrentUserActInExecution = false;

  if (isWithdrawn) {
    stage1 = { ...stage1, status: 'blocked', detail: 'مسحوبة بخطة انتقال' };
    stage2 = { ...stage2, status: 'blocked', detail: 'أوقفت المهمة' };
    stage3 = { ...stage3, status: 'blocked', detail: 'غير مطلوب' };
    stage4 = { ...stage4, status: 'blocked', detail: 'مغلقة بالسحب' };
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary: 'تم سحب هذه المهمة ضمن خطة انتقال إصدار برنامج الصيانة.',
      waitingOn: 'مكتمل (مسحوبة)',
      nextStep: 'لا يلزم أي إجراء على هذه النسخة المسحوبة.',
      executionBadgeLabel: 'مسحوبة بخطة انتقال',
      executionGuidance: 'هذه المهمة مسحوبة بخطة انتقال ولا تقبل تنفيذًا جديدًا.',
      canCurrentUserActInExecution: false,
    };
  }

  if (isClosed || execState === 'approved') {
    stage1 = { ...stage1, status: 'done', detail: t.schedule ? 'مهيأة آليًا' : 'مكتملة' };
    stage2 = { ...stage2, status: 'done', detail: 'معتمد للتخطيط' };
    stage3 = { ...stage3, status: 'done', detail: 'تم توثيق الإنجاز' };
    stage4 = { ...stage4, status: 'done', detail: t.nextTaskId ? 'اعتمد وأُنشئت المرة التالية' : 'اعتمد وأُغلقت المرة' };
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary: t.nextTaskId
        ? 'اكتملت دورة هذه المرة: اعتُمد التنفيذ وأُنشئت المرة التالية تلقائيًا.'
        : 'اكتملت دورة هذه المهمة: اعتُمد التنفيذ وأُغلقت المهمة.',
      waitingOn: 'مكتمل',
      nextStep: t.nextTaskId ? 'افتح المرة التالية لمتابعة الاستحقاق الجديد.' : 'السجل مغلق ومؤرشف للتدقيق.',
      executionBadgeLabel: 'التنفيذ: معتمد ومغلق',
      executionGuidance: null,
      canCurrentUserActInExecution: false,
    };
  }

  if (needsInit) {
    stage1 = { ...stage1, status: 'active', detail: 'بحاجة لتهيئة الاستحقاق الأول' };
    stage2 = { ...stage2, status: 'pending', detail: 'يبدأ بعد التهيئة' };
    summary = 'المهمة مربوطة ببرنامج صيانة، وتحتاج أولًا إلى «تهيئة الاستحقاق الأول» لتطبيق قواعد البرنامج.';
    waitingOn = 'المخطط أو مدير النظام';
    nextStep = 'افتح تبويب «التهيئة والقواعد والتسامح» واضغط «تهيئة الاستحقاق الأول».';
    executionBadgeLabel = 'بحاجة لتهيئة الحساب الآلي';
    canCurrentUserActInExecution = canEditTask && (!program || program.state === 'approved');
    if (!canCurrentUserActInExecution) {
      executionGuidance = canEditTask
        ? 'يلزم اعتماد إصدار البرنامج المرتبط أولًا قبل تهيئة الاستحقاق الآلي.'
        : 'المهمة بانتظار المخطط أو مدير النظام لتهيئة الاستحقاق الأول من تبويب التهيئة، ثم اعتماد التخطيط قبل بدء التنفيذ.';
    }
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary,
      waitingOn,
      nextStep,
      executionBadgeLabel,
      executionGuidance,
      canCurrentUserActInExecution,
    };
  }

  if (reviewState !== 'approved') {
    if (reviewState === 'draft') {
      stage1 = { ...stage1, status: 'active', detail: 'مسودة تخطيط' };
      stage2 = { ...stage2, status: 'pending', detail: 'بانتظار الإرسال للمراجعة' };
      summary = 'تخطيط المهمة لا يزال في حالة «مسودة» ولم يُرسل بعد للاعتماد.';
      waitingOn = 'المخطط أو مدير النظام';
      nextStep = 'من جدول «خطة الصيانة» أو «مسار الاعتماد وسجله»، أرسل التخطيط للمراجعة أولًا.';
    } else if (reviewState === 'submitted') {
      stage2 = {
        ...stage2,
        status: 'active',
        detail: mode === 'two_person' ? 'بانتظار المراجعة والاعتماد' : 'بانتظار المراجعة الفنية',
      };
      summary =
        mode === 'two_person'
          ? 'تخطيط المهمة مُرسل وبانتظار مراجعته واعتماده في «مسار الاعتماد وسجله».'
          : 'تخطيط المهمة مُرسل وبانتظار المراجعة الفنية من حساب المراجع.';
      waitingOn = mode === 'two_person' ? 'المعتمد' : 'المراجع';
      nextStep = 'أكمل اعتماد التخطيط من «خطة الصيانة» حتى تصبح الحالة «معتمد للتخطيط» قبل إرسال التنفيذ.';
    } else {
      stage2 = { ...stage2, status: 'active', detail: 'بانتظار الاعتماد النهائي للتخطيط' };
      summary = 'تمت مراجعة التخطيط، وبانتظار اعتماد التخطيط من حساب المعتمد.';
      waitingOn = 'المعتمد';
      nextStep = 'من حساب المعتمد في «خطة الصيانة»، اعتمد التخطيط لفتح مسار إرسال التنفيذ.';
    }

    // Even before planning approval, record_execution can save a draft if allowed
    if (!execState) {
      executionBadgeLabel = 'التنفيذ: بانتظار اعتماد التخطيط';
      canCurrentUserActInExecution = canRecord;
      executionGuidance =
        'ملاحظة مهمة: هذه المرحلة لا تزال في «اعتماد التخطيط». يمكن حفظ مسودة تنفيذ الآن، لكن لن يظهر زر «إرسال التنفيذ للمراجعة» أو أزرار المراجعة والاعتماد للتنفيذ إلا بعد اعتماد تخطيط المهمة أولًا من «خطة الصيانة».';
    } else if (execState === 'draft') {
      stage3 = { ...stage3, status: 'active', detail: 'مسودة تنفيذ محفوظة' };
      executionBadgeLabel = 'التنفيذ: مسودة (ينتظر اعتماد التخطيط)';
      canCurrentUserActInExecution = canRecord;
      executionGuidance =
        'تم حفظ مسودة التنفيذ، ولكن إرسالها للمراجعة متوقف حتى يصبح تخطيط المهمة «معتمد للتخطيط» في خطة الصيانة.';
    }
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary,
      waitingOn,
      nextStep,
      executionBadgeLabel,
      executionGuidance,
      canCurrentUserActInExecution,
    };
  }

  // Planning IS approved -> now focus on Execution (Stages 3 & 4)
  if (!execState) {
    stage3 = { ...stage3, status: 'active', detail: 'لم يُسجل تنفيذ بعد' };
    summary = 'تخطيط المهمة معتمد. الخطوة الحالية هي تسجيل بيانات التنفيذ الفعلي وإرسالها للمراجعة.';
    waitingOn = 'المنفذ / المخطط أو مدير النظام';
    nextStep = 'أدخل تاريخ التنفيذ والعدادات ومرجع أمر العمل واسم المنفذ، ثم اضغط «حفظ مسودة التنفيذ» وبعدها «إرسال التنفيذ للمراجعة».';
    executionBadgeLabel = 'التنفيذ: لم يُسجل بعد';
    canCurrentUserActInExecution = canRecord;
    if (!canRecord) {
      executionGuidance =
        'تخطيط المهمة معتمد بالفعل، ولكن سجل التنفيذ لم يُنشأ بعد. بانتظار قيام المنفذ أو المخطط أو مدير النظام بحفظ مسودة التنفيذ وإرسالها للمراجعة، وعندها ستظهر أزرار المراجعة ثم «اعتماد التنفيذ وحساب التالي» للمعتمد.';
    }
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary,
      waitingOn,
      nextStep,
      executionBadgeLabel,
      executionGuidance,
      canCurrentUserActInExecution,
    };
  }

  if (execState === 'draft') {
    stage3 = { ...stage3, status: 'active', detail: 'مسودة تنفيذ غير مرسلة' };
    summary = 'سجل التنفيذ محفوظ كمسودة فقط، ولم يُرسل للمراجعة بعد.';
    waitingOn = 'المخطط أو مدير النظام (صاحب صلاحية الإرسال)';
    nextStep = 'اضغط «إرسال التنفيذ للمراجعة» لتنتقل المهمة إلى المراجع.';
    executionBadgeLabel = 'التنفيذ: مسودة (بانتظار الإرسال)';
    canCurrentUserActInExecution = canRecord || canSubmit;
    if (!canCurrentUserActInExecution) {
      executionGuidance =
        'توجد مسودة تنفيذ محفوظة لكنها لم تُرسل للمراجعة بعد. يجب أن يضغط المخطط أو مدير النظام زر «إرسال التنفيذ للمراجعة» أولًا قبل أن تظهر للمراجع أو المعتمد.';
    }
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary,
      waitingOn,
      nextStep,
      executionBadgeLabel,
      executionGuidance,
      canCurrentUserActInExecution,
    };
  }

  if (execState === 'submitted') {
    stage3 = { ...stage3, status: 'done', detail: 'أُرسل التنفيذ للمراجعة' };
    stage4 = { ...stage4, status: 'active', detail: 'بانتظار تأكيد المراجعة' };
    const sameAuthor = Boolean(userId && (accomplishment?.modified_by === userId || accomplishment?.submitted_by === userId));
    const canReviewerAct = canReview && !sameAuthor;
    summary = 'سجل التنفيذ مُرسل وبانتظار تأكيد المراجعة الفنية المستقلة.';
    waitingOn = 'المراجع';
    nextStep = 'من حساب المراجع: اضغط «تأكيد مراجعة التنفيذ»، وبعدها سينتقل الطلب إلى المعتمد لظهور «اعتماد التنفيذ وحساب التالي».';
    executionBadgeLabel = 'التنفيذ: بانتظار المراجعة';
    canCurrentUserActInExecution = canReviewerAct || canRecord;
    if (sameAuthor && canReview) {
      executionGuidance =
        'لقد أعددت أو أرسلت سجل التنفيذ هذا بنفسك؛ التزامًا بفصل الصلاحيات يجب أن يضغط مستخدم مستقل بصلاحية المراجع زر «تأكيد مراجعة التنفيذ».';
      canCurrentUserActInExecution = canRecord;
    } else if (!canReview) {
      executionGuidance = canApprove
        ? 'سجل التنفيذ الآن بانتظار المراجع لتأكيد المراجعة أولًا؛ فور تأكيد المراجعة سيظهر لك هنا زر «اعتماد التنفيذ وحساب التالي».'
        : 'سجل التنفيذ مرسل وبانتظار مراجعة حساب المراجع ثم اعتماد المعتمد.';
    }
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary,
      waitingOn,
      nextStep,
      executionBadgeLabel,
      executionGuidance,
      canCurrentUserActInExecution,
    };
  }

  if (execState === 'reviewed') {
    stage3 = { ...stage3, status: 'done', detail: 'أُرسل التنفيذ للمراجعة' };
    stage4 = { ...stage4, status: 'active', detail: 'بانتظار اعتماد التنفيذ وحساب التالي' };
    const sameAuthorOrReviewer = Boolean(
      userId &&
        (accomplishment?.modified_by === userId ||
          accomplishment?.submitted_by === userId ||
          accomplishment?.reviewed_by === userId)
    );
    const canApproverAct = canApprove && !sameAuthorOrReviewer;
    summary = 'تمت مراجعة التنفيذ فنيًا، وهو جاهز الآن للاعتماد النهائي وتوليد المرة التالية.';
    waitingOn = 'المعتمد';
    nextStep = 'من حساب المعتمد: اضغط «اعتماد التنفيذ وحساب التالي» لإغلاق هذه المرة وإنشاء المرة التالية تلقائيًا.';
    executionBadgeLabel = 'التنفيذ: بانتظار الاعتماد';
    canCurrentUserActInExecution = canApproverAct || canRecord;
    if (sameAuthorOrReviewer && canApprove) {
      executionGuidance =
        'التزامًا بفصل الصلاحيات، لا يمكن لمن أعدّ أو راجع التنفيذ أن يعتمده. يجب تسجيل الدخول بحساب معتمد مستقل (أو دور المعتمد) ليظهر زر «اعتماد التنفيذ وحساب التالي».';
      canCurrentUserActInExecution = canRecord;
    } else if (!canApprove) {
      executionGuidance =
        role === 'reviewer'
          ? 'تمت مراجعتك بنجاح! ينتظر السجل الآن تسجيل الدخول بحساب «المعتمد» ليظهر له زر «اعتماد التنفيذ وحساب التالي».'
          : 'تمت مراجعة التنفيذ وبانتظار حساب «المعتمد» لتنفيذ الاعتماد النهائي وحساب المرة التالية.';
    }
    return {
      stages: [stage1, stage2, stage3, stage4],
      summary,
      waitingOn,
      nextStep,
      executionBadgeLabel,
      executionGuidance,
      canCurrentUserActInExecution,
    };
  }

  return {
    stages: [stage1, stage2, stage3, stage4],
    summary: 'راجع حالة المهمة وسجل التنفيذ.',
    waitingOn: 'غير محدد',
    nextStep: 'راجع التفاصيل المتاحة.',
    executionBadgeLabel: 'قيد المتابعة',
    executionGuidance: null,
    canCurrentUserActInExecution: canRecord,
  };
}
