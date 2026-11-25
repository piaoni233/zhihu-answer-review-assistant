// @ts-check

/**
 * 全局 JSDoc 类型定义（对应详细设计 §1.4、§4.1、§5.1、§7）
 * 纯类型模块，无运行时副作用。
 */

/**
 * @typedef {'upvotes'|'views'|'collects'|'comments'|'endorseLikes'|'shares'|'title'|'published'|'categoryTag'} CanonicalField
 */

/**
 * @typedef {'error'|'warning'|'notice'} IssueSeverity
 */

/**
 * @typedef {Object} ParseIssue
 * @property {IssueSeverity} severity
 * @property {string} code
 * @property {number} blockIndex
 * @property {number} startLine
 * @property {number} line
 * @property {string} [fieldLabel]
 * @property {string} message
 * @property {string} [fixHint]
 */

/**
 * @typedef {Object} ParsedDate
 * @property {number} utcMs
 * @property {string} dateStr
 * @property {boolean} hasTime
 */

/**
 * @typedef {Object} ParsedAnswer
 * @property {number} blockIndex
 * @property {number} startLine
 * @property {Record<string, number>} [fieldLines]
 * @property {string} title
 * @property {string} publishedRaw
 * @property {number|null} publishedUtcMs
 * @property {string|null} publishedDateStr
 * @property {number} views
 * @property {number} upvotes
 * @property {number} collects
 * @property {number} comments
 * @property {number|null} endorseLikes
 * @property {number|null} shares
 * @property {string|null} categoryTag
 * @property {string[]} commentsText
 * @property {string[]} maskedCommentsText
 */

/**
 * @typedef {Object} ParseResult
 * @property {ParsedAnswer[]} items
 * @property {ParseIssue[]} blockingErrors
 * @property {ParseIssue[]} warnings
 * @property {ParseIssue[]} notices
 * @property {number} totalBlocks
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} canGenerate
 * @property {boolean} needsConfirmation
 * @property {boolean} canRank
 * @property {ParseIssue[]} blockingErrors
 * @property {ParseIssue[]} softWarnings
 * @property {ParseIssue[]} notices
 */

/**
 * @typedef {Object} AnswerMetrics
 * @property {ParsedAnswer} raw
 * @property {number|null} upvoteRate
 * @property {number|null} collectRate
 * @property {number|null} commentRate
 * @property {number|null} engagementRate
 * @property {number|null} collectUpvoteRatio
 * @property {number|null} ageDays
 * @property {boolean} isSmallSample
 * @property {boolean} isImmature
 * @property {number} rank
 */

/**
 * @typedef {Object} BatchTotals
 * @property {number} views
 * @property {number} upvotes
 * @property {number} collects
 * @property {number} comments
 * @property {number} interactions
 * @property {number} endorseLikes
 * @property {number} shares
 * @property {boolean} hasEndorseLikes
 * @property {boolean} hasShares
 */

/**
 * @typedef {Object} BatchMedians
 * @property {number|null} upvoteRate
 * @property {number|null} collectRate
 * @property {number|null} commentRate
 * @property {number|null} engagementRate
 */

/**
 * @typedef {Object} BatchTimeSpan
 * @property {number|null} spanDays
 * @property {string|null} earliestDate
 * @property {string|null} latestDate
 * @property {number|null} minAgeDays
 * @property {number|null} maxAgeDays
 * @property {boolean} hasLargeAgeSpread
 */

/**
 * @typedef {Object} BatchMetrics
 * @property {number} asOfUtcMs
 * @property {string} asOfDisplay
 * @property {AnswerMetrics[]} items
 * @property {AnswerMetrics[]} ranked
 * @property {BatchTotals} totals
 * @property {number|null} weightedEngagementRate
 * @property {BatchMedians} medians
 * @property {BatchTimeSpan} timeSpan
 */

/**
 * @typedef {'question_doubt'|'follow_up'|'urge_update'|'bookmark_mark'|'endorsement'|'unclassified'} CommentCategory
 */

/**
 * @typedef {Object} ClassifiedComment
 * @property {string} text
 * @property {CommentCategory} category
 * @property {string} label
 */

/**
 * @typedef {Object} CommentAnalysis
 * @property {number} total
 * @property {Record<CommentCategory, number>} counts
 * @property {ClassifiedComment[]} items
 */

/**
 * @typedef {'high'|'normal'|'low'|'na'} RelativeLevel
 */

/**
 * @typedef {Object} RelativeMetricEval
 * @property {number|null} ratioToMedian
 * @property {RelativeLevel} level
 * @property {string} description
 */

/**
 * @typedef {Object} AnswerDiagnosis
 * @property {string} title
 * @property {number} blockIndex
 * @property {RelativeMetricEval} upvoteRel
 * @property {RelativeMetricEval} collectRel
 * @property {RelativeMetricEval} commentRel
 * @property {RelativeMetricEval} engagementRel
 * @property {string} structureSignal
 * @property {CommentAnalysis} commentAnalysis
 * @property {string|null} categoryReferenceNote
 */

/**
 * @typedef {Object} RoleCard
 * @property {string} key
 * @property {string} roleTitle
 * @property {string} answerTitle
 * @property {number} blockIndex
 * @property {boolean} isImmature
 * @property {boolean} isSmallSample
 * @property {string[]} tiedTitles
 * @property {string[]} bullets
 * @property {number|null} [potentialGap]
 * @property {boolean} [isCombinedWithBest]
 */

/**
 * @typedef {'立即编辑原回答'|'下一篇回答应用'|'记录观察'} ActionPriority
 */

/**
 * @typedef {Object} ActionItem
 * @property {string} title
 * @property {string} problem
 * @property {string} evidence
 * @property {string} action
 * @property {ActionPriority} priority
 */

/**
 * @typedef {Object} HistoryBaseline
 * @property {number|null} medianEngagementRate
 * @property {number|null} medianUpvoteRate
 * @property {number|null} medianCollectRate
 * @property {number|null} medianCommentRate
 * @property {number} sampleCount
 * @property {Record<string, {sampleCount: number, medianEngagementRate: number|null}>} [byCategory]
 */

/**
 * @typedef {Object} DiagnosisResult
 * @property {boolean} canRank
 * @property {boolean} allSmallSample
 * @property {boolean} allEngagementTied
 * @property {number|null} engagementSpreadPp
 * @property {string[]} ageAndSampleWarnings
 * @property {string|null} historyComparisonNote
 * @property {AnswerDiagnosis[]} perAnswer
 * @property {{best: RoleCard|null, benchmark: RoleCard|null, worst: RoleCard|null, topOpportunity: RoleCard|null}} roles
 * @property {ActionItem[]} actions
 * @property {number} totalCandidateActions
 */

/**
 * @typedef {Object} AnswerDelta
 * @property {string} title
 * @property {string} publishedDateStr
 * @property {string} prevAsOfDisplay
 * @property {number} prevAsOfUtcMs
 * @property {number} viewsDelta
 * @property {number} upvotesDelta
 * @property {number} collectsDelta
 * @property {number} commentsDelta
 * @property {number|null} incrementalEngagementRate
 * @property {boolean} hasAnomaly
 */

/**
 * @typedef {Object} AiRewriteSuggestion
 * @property {string} targetTitle
 * @property {string} diagnosis
 * @property {string} concreteEdit
 */

/**
 * @typedef {Object} AiVerificationReport
 * @property {boolean} hasUnverified
 * @property {number} unverifiedCount
 * @property {string[]} unverifiedTokens
 */

/**
 * @typedef {Object} AiDiagnosisResult
 * @property {'sample_pregenerated'|'live_byok'} mode
 * @property {string} providerId
 * @property {string} providerName
 * @property {string} model
 * @property {number} generatedAtUtcMs
 * @property {string} disclaimer
 * @property {string} overallInsight
 * @property {string[]} commentReinterpretation
 * @property {AiRewriteSuggestion[]} rewriteSuggestions
 * @property {AiVerificationReport} verification
 */

/**
 * @typedef {Object} Settings
 * @property {number} ageThresholdDays
 * @property {number} smallSampleThreshold
 * @property {boolean} maskMentionHandles
 * @property {string} aiProviderId
 * @property {string} aiModel
 * @property {boolean} rememberApiKey
 */

/**
 * @typedef {Object} ReportModel
 * @property {{reviewId:string, createdAtUtcMs:number, asOfUtcMs:number, asOfDisplay:string, engineVersion:string, isSample:boolean, itemCount:number, earliestDate:string|null, latestDate:string|null, spanDays:number|null, ageThresholdDays:number, smallSampleThreshold:number}} meta
 * @property {{headline:string, disclaimer:string, sampleNotice:string|null, historyComparisonNote:string|null, weightedEngagementRate:string, medianEngagementRate:string, engagementSpreadPp:string|null}} summary
 * @property {Array<{blockIndex:number, title:string, publishedRaw:string, ageDays:number|null, ageText:string, views:number, upvotes:number, collects:number, comments:number, endorseLikes:number|null, shares:number|null, categoryTag:string|null, upvoteRate:string, collectRate:string, commentRate:string, engagementRate:string, collectUpvoteRatio:string, isSmallSample:boolean, isImmature:boolean, rank:number}>} overviewRows
 * @property {{views:number, upvotes:number, collects:number, comments:number, interactions:number, endorseLikes:number, shares:number, hasEndorseLikes:boolean, hasShares:boolean, weightedEngagementRate:string}} totals
 * @property {string[]} formulasNote
 * @property {boolean} canRank
 * @property {Array<{rank:number, title:string, engagementRate:string, medianRatioText:string, views:number, collectUpvoteRatio:string, tags:string[]}>} rankingItems
 * @property {string[]} ageAndSampleWarnings
 * @property {{allEngagementTied:boolean, tiedNote:string|null, best:RoleCard|null, benchmark:RoleCard|null, worst:RoleCard|null, topOpportunity:RoleCard|null}} roles
 * @property {{disclaimer:string, items:Array<{title:string, total:number, counts:Record<CommentCategory, number>, comments:ClassifiedComment[]}>}} commentInsights
 * @property {ActionItem[]} actions
 * @property {AnswerDelta[]} crossPeriodDeltas
 * @property {string} nextTemplate
 * @property {AiDiagnosisResult|null} aiSection
 */

/**
 * @typedef {Object} ReviewRecord
 * @property {string} id
 * @property {number} createdAtUtcMs
 * @property {number} asOfUtcMs
 * @property {string} engineVersion
 * @property {Settings} settingsSnapshot
 * @property {boolean} isSample
 * @property {string} rawInputText
 * @property {ParsedAnswer[]} answers
 * @property {ReportModel} reportModel
 * @property {AiDiagnosisResult|null} aiDiagnosis
 */

/**
 * @typedef {Object} AnswerTimelineEntry
 * @property {string} reviewId
 * @property {number} asOfUtcMs
 * @property {string} asOfDisplay
 * @property {number} views
 * @property {number} upvotes
 * @property {number} collects
 * @property {number} comments
 * @property {number|null} engagementRate
 * @property {number|null} upvoteRate
 * @property {number|null} collectRate
 * @property {number|null} commentRate
 */

/**
 * @typedef {Object} AnswerIndexRecord
 * @property {string} answerKey
 * @property {string} normTitle
 * @property {string} title
 * @property {string} publishedDateStr
 * @property {string|null} categoryTag
 * @property {number} lastUpdatedUtcMs
 * @property {AnswerTimelineEntry[]} timeline
 */

export const ENGINE_VERSION = '1.0.0';
