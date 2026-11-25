// @ts-check

/**
 * 知乎五类评论分类器（详细设计 §3.4）
 * 判定优先级（单条仅归入一类，确保总数可验算）：
 * 质疑求证 > 追问（显式关键词）> 催更/蹲后续 > 追问（问号兜底）> 收藏标记 > 认可 > 未分类
 */

/** @type {Record<import('../types.js').CommentCategory, string>} */
export const COMMENT_CATEGORY_LABELS = {
  question_doubt: '质疑求证',
  follow_up: '追问',
  urge_update: '催更/蹲后续',
  bookmark_mark: '收藏标记',
  endorsement: '认可',
  unclassified: '未分类',
};

const DOUBT_KEYWORDS = [
  '来源', '出处', '数据呢', '依据', '参考文献', '文献', '证据', '怎么证明',
  '你确定', '真的吗', '假吧', '胡说', '扯', '瞎说', '误导', '偷换概念',
  '幸存者偏差', '以偏概全', '逻辑漏洞', '片面', '不敢苟同', '恰饭', '广告',
  '软文', '洗地', '外行', '胡扯', '编的', '一眼假', '太绝对',
];

const DOUBT_PATTERNS = [
  /(有|拿).*数据/i,
  /(哪|什么).*来源/,
];

const STRONG_FOLLOW_UP_KEYWORDS = [
  '请问', '怎么', '如何', '能不能', '可以吗', '行吗', '有没有', '哪款',
  '哪个', '哪里', '多少', '第几', '能展开', '展开说说',
  '怎么办', '为啥', '为什么', '什么意思',
];

const FOLLOW_UP_REQUEST_RE = /(?<![需要追])求/;

const SOFT_FOLLOW_UP_KEYWORDS = [
  '具体', '细节', '步骤', '教程', '模板', '适合',
];

const URGE_UPDATE_KEYWORDS = [
  '蹲', '插眼', '踢我', '踢一下', '等后续', '等更新', '催更', '求更',
  '更了吗', '还有下文吗', '下一期', '下篇', '快更', '坐等',
];

const BOOKMARK_KEYWORDS = [
  '已收藏', '收藏了', '先赞后看', '赞了再看', '马住', '码住', '马克',
  'mark', '先存', '留着看', '存下来', '收藏夹',
];

const ENDORSEMENT_KEYWORDS = [
  '说得好', '讲得好', '讲透了', '写得好', '透彻', '受教', '学到了', '干货',
  '专业', '中肯', '客观', '赞同', '同意', '支持', '确实', '在理',
  '深有同感', '说到心坎', '终于有人说', '良心', '硬核', '牛', '厉害',
];

/**
 * @param {string} lower
 * @param {string[]} keywords
 * @returns {boolean}
 */
function hasAnyKeyword(lower, keywords) {
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * 对单条知乎评论按优先级分类。
 * @param {string} commentText
 * @returns {import('../types.js').CommentCategory}
 */
export function classifyZhihuComment(commentText) {
  if (typeof commentText !== 'string' || !commentText.trim()) {
    return 'unclassified';
  }
  const lower = commentText.toLowerCase();

  // 1. 质疑求证（优先级最高）
  if (hasAnyKeyword(lower, DOUBT_KEYWORDS) || DOUBT_PATTERNS.some((re) => re.test(commentText))) {
    return 'question_doubt';
  }

  // 2a. 明确催更/蹲后续（如“蹲”“插眼”“求更”“等后续”），仅当同时包含显式疑问词时归为追问
  if (hasAnyKeyword(lower, URGE_UPDATE_KEYWORDS)) {
    if (hasAnyKeyword(lower, STRONG_FOLLOW_UP_KEYWORDS)) {
      return 'follow_up';
    }
    return 'urge_update';
  }

  // 2b. 强追问信号（明确提问/请求词、非“需求/要求/追求”中的“求”或问号）
  if (
    hasAnyKeyword(lower, STRONG_FOLLOW_UP_KEYWORDS) ||
    FOLLOW_UP_REQUEST_RE.test(commentText) ||
    lower.includes('?') ||
    lower.includes('？')
  ) {
    return 'follow_up';
  }

  // 4. 收藏标记
  if (hasAnyKeyword(lower, BOOKMARK_KEYWORDS)) {
    return 'bookmark_mark';
  }

  // 5. 认可
  if (hasAnyKeyword(lower, ENDORSEMENT_KEYWORDS)) {
    return 'endorsement';
  }

  // 2c. 弱追问词兜底（仅当非催更、非收藏标记、非认可时触发）
  if (hasAnyKeyword(lower, SOFT_FOLLOW_UP_KEYWORDS)) {
    return 'follow_up';
  }

  // 6. 未分类
  return 'unclassified';
}

/**
 * 批量分析评论并汇总各类计数。
 * @param {string[]} comments
 * @returns {import('../types.js').CommentAnalysis}
 */
export function analyzeComments(comments) {
  /** @type {Record<import('../types.js').CommentCategory, number>} */
  const counts = {
    question_doubt: 0,
    follow_up: 0,
    urge_update: 0,
    bookmark_mark: 0,
    endorsement: 0,
    unclassified: 0,
  };

  /** @type {import('../types.js').ClassifiedComment[]} */
  const items = [];

  for (const raw of comments || []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const category = classifyZhihuComment(text);
    counts[category] += 1;
    items.push({
      text,
      category,
      label: COMMENT_CATEGORY_LABELS[category],
    });
  }

  return {
    total: items.length,
    counts,
    items,
  };
}
