import type { SupabaseClient } from "@supabase/supabase-js";
import {
  budgetAlertsFor,
  budgetReadingFor,
  dailyBudgetAlertsFor,
  type BudgetStatus,
} from "@/lib/budget-alert";
import { calendarMonthRange, cycleRange, dayRange } from "@/lib/budget-cycle";
import { categorizeByRules, matchLeadingCategory, type CategoryLite } from "@/lib/categorize/rules";
import { parseCommand, type Command } from "@/lib/commands";
import { formatBaht, satangToString, toSatang } from "@/lib/money";
import {
  CONFIRM_THRESHOLD,
  LARGE_AMOUNT_SATANG,
  parseMessage,
  type ParsedEntry,
} from "@/lib/parse/text-parser";
import {
  categoryTotalSatang,
  ensureUser,
  expenseTotalSatang,
  getLatestConfirmed,
  getRecentlyEdited,
  getBudgetMode,
  getSettings,
  getTransaction,
  claimPendingTransaction,
  insertTransaction,
  loadCategories,
  loadMemoryFor,
  releasePendingTransaction,
  txAmountSatang,
  updateTransaction,
  type SettingsRow,
  type TxRow,
  type UserRow,
} from "@/lib/repo";
import { bangkokParts, formatThaiDate, fromBangkok, isValidYmd } from "@/lib/thai-date";
import type { LineMessage, TxType } from "@/lib/types";
import type { SlipImage, SlipOcrProvider } from "@/lib/ocr/provider";
import { can, effectivePlan } from "@/lib/plan";
import {
  applyTheme,
  DEFAULT_PERSONA,
  DEFAULT_THEME,
  effectivePrefs,
  savedQuip,
} from "@/lib/personalize";
import { LIMITS, type LimitRule, type RateLimitResult } from "@/lib/rate-limit";
import {
  applyReferralCode,
  awardActivity,
  currentStreak,
  recentDailyKeys,
  redeemable,
} from "@/lib/points";
import { cancelSlipEntries, getSlip, getSlipItems, learnMerchant } from "@/lib/slip-repo";
import { planReceiptSplit } from "@/lib/receipt-split";
import { categoryLabel } from "@/lib/category-emoji";
import { buildCategorySlices } from "@/lib/category-spend";
import { loadSearchItems, loadSearchTotals, parseSearchTerm } from "@/lib/search";
import { describeTotals, sameSpanRanges } from "@/lib/period-compare";
import {
  loadCategoryCompare,
  loadForecastInput,
  loadInsightFacts,
  loadCategorySpend,
  loadSummaryData,
  loadSummaryTransactions,
  loadYearData,
} from "@/lib/summary-load";
import { generateInsight, type InsightWriter } from "@/lib/ai/insight-writer";
import { forecastCycle } from "@/lib/forecast";
import { hasSomethingToSay } from "@/lib/insight";
import { resolveYear } from "@/lib/year-summary";
import { daySpecFromIso, resolveRange, type DaySpec } from "@/lib/summary-range";
import {
  buildSummaryCard,
  expenseChangePercent,
  previousRange,
  rangeLabel,
  summarize,
} from "@/lib/summary-report";
import { handleSlipImage, type SlipCardExtras } from "@/lib/slips";
import type { PdfReader } from "@/lib/ai/pdf-reader";
import { cancelImport, confirmImport } from "@/lib/pdf-repo";
import { handlePdfMessage, type PdfDeps } from "./pdf";
import { handlePhotoImage, photoBlockedReply } from "@/lib/photos";
import { needsSmartParse, runSmartParse } from "@/lib/ai/smart-parse";
import type { TextStructurer } from "@/lib/ai/text-structurer";
import { recordSmartEntries } from "./smart-entries";
import { buildForecastCard } from "./forecast-flex";
import { buildInsightCard } from "./insight-flex";
import { buildTransferDone, buildWalletChooser, buildWalletsCard } from "./wallet-flex";
import { buildCardsCard } from "./card-flex";
import { JOIN_FAIL_TEXT } from "@/lib/shared-wallet";
import { createInvite, membersOf, redeemInvite, removeMember } from "@/lib/shared-wallet-repo";
import { sharedMemberLimit } from "@/lib/plan";
import { convertForeignEntries, fxNoteOf } from "./fx-entries";
import { handleGroupEvent } from "./group-handlers";
import { buildBillsCard } from "./bill-flex";
import {
  MAX_ACTIVE_BILLS,
  addDays as addBillDays,
  cardBills,
  firstDue,
  resolveBill,
  todayKey as billTodayKey,
} from "@/lib/bill";
import { recordBillExpense, settleBill } from "@/lib/bill-actions";
import { claimReminder, createBill, getBill, listBills, updateBill } from "@/lib/bill-repo";
import { buildGoalDone, buildGoalReachedCard, buildGoalsCard } from "./goal-flex";
import { dueSpecToDate, goalProgress, resolveGoal } from "@/lib/goal";
import { addDeposit, createGoal, listGoals, undoDeposit } from "@/lib/goal-repo";
import { goalCapacity } from "@/lib/plan";
import { dailyBudgetStatus } from "@/lib/daily-budget";
import { bangkokDateKey } from "@/lib/points";
import { buildDebtDone, buildDebtsCard } from "./debt-flex";
import {
  MAX_OPEN_DEBTS_PER_PERSON,
  cleanPerson,
  planPayment,
  resolveDue,
  totalsByPerson,
} from "@/lib/debt";
import {
  addPayments,
  createDebt,
  deleteDebt,
  deletePayments,
  listDebts,
  openDebtsOf,
} from "@/lib/debt-repo";
import { limitAlert } from "@/lib/card";
import { loadCardStatuses } from "@/lib/card-repo";
import { createTransfer, deleteTransfer } from "@/lib/transfer-repo";
import {
  cancelReminder,
  countActiveReminders,
  createReminder,
  listReminders,
} from "@/lib/user-reminder-repo";
import { describeReminder, parseReminder, reminderCapacity } from "@/lib/user-reminder";
import { buildReminderCard } from "./reminder-flex";
import { buildOpenPageCard, PAGE_INFO } from "./page-flex";
import { buildSummaryMenu } from "./summary-menu";
import { PRESET_TITLE, presetRange } from "@/lib/summary-range-text";
import type { Owl } from "@/lib/ai/owl";
import { inOwlMode, keepOwlOpen, owlAsk, owlEnd, owlStart, type OwlDeps } from "./owl";
import type { IntentRouter } from "@/lib/ai/intent-router";
import { needsRouter } from "@/lib/ai/route-text";
import {
  handleFilePick,
  handleIncomingFile,
  keepOffer,
  offerToKeep,
  runFileList,
  runFileRename,
  runFileSave,
  runFileSearch,
  saveWaitingFile,
  type FileChatDeps,
} from "./file-handlers";
import { forgetMedia, rememberMedia, takeFileWait } from "@/lib/file-repo";
import type { SaveDeps } from "@/lib/file-save";
import { handleIntentPick, routeText, type IntentDeps } from "./intent-handlers";
import { cleanNoteBody, MAX_NOTE_LENGTH, noteCapacity, noteTitle } from "@/lib/note";
import { countNotes, createNote, deleteNote, listNotes } from "@/lib/note-repo";
import { looksSecret } from "@/lib/secret-text";
import { ensureWallets, listWallets, setEntryWallet, setSlipWallet } from "@/lib/wallet-repo";
import { balanceOf, resolveWallet, walletLabel, type Wallet } from "@/lib/wallet";
import { walletCapacity } from "@/lib/plan";
import { buildSearchCard } from "./search-flex";
import {
  buildCategorySpendCard,
  buildCompareCard,
  buildRecentCard,
  buildYearCard,
} from "./spend-flex";
import { getLivePhotoWait, getPhotoTx, startPhotoWait } from "@/lib/photo-repo";
import {
  BACKDATE_MAX_DAYS,
  buildBackdatePrompt,
  buildCategoryKeyboardList,
  buildComposeCard,
  buildConfirmMessage,
  buildDatePicker,
  buildPhotoAsk,
  buildRangeEndPicker,
  buildRangeStartPicker,
  withSummaryShortcuts,
  buildTypeQuestion,
} from "./flex";
import { buildCategoryChooser } from "./slip-flex";
import { startTrialFromChat, upsellReply } from "./upsell-reply";
import { runPaymentCommand } from "./payment-handlers";
import { buildHelpPrompt, buildHelpTopicCard, buildWelcomeCard, isHelpTopic } from "./help-flex";
import { notUnderstood } from "./not-understood";
import {
  EDIT_HINT_TEXT,
  EDIT_LINK_TEXT,
  EDIT_USAGE_TEXT,
  BACKDATE_BAD_DATE_TEXT,
  BACKDATE_LOCKED_TEXT,
  BACKDATE_PICKER_LOCKED_TEXT,
  MULTI_ENTRY_LOCKED_TEXT,
  TAGS_LOCKED_TEXT,
  ERROR_TEXT,
  MEMORY_PLUS_HINT_TEXT,
  NOT_FOUND_TEXT,
  PHOTO_ASK_REPLACE_TEXT,
  PHOTO_ASK_TEXT,
  COMPARE_EMPTY_TEXT,
  COMPARE_LOCKED_TEXT,
  INSIGHT_EMPTY_TEXT,
  INSIGHT_LIMIT_TEXT,
  INSIGHT_LOCKED_TEXT,
  FORECAST_EMPTY_TEXT,
  FORECAST_LOCKED_TEXT,
  RECENT_EMPTY_TEXT,
  SEARCH_LOCKED_TEXT,
  SEARCH_USAGE_TEXT,
  searchEmptyText,
  SMART_CANCELLED_TEXT,
  SMART_PREFACE_TEXT,
  SPLIT_LOCKED_TEXT,
  SUMMARY_RANGE_BAD_DATE_TEXT,
  SUMMARY_RANGE_LOCKED_TEXT,
  SUMMARY_RANGE_ORDER_TEXT,
  SUMMARY_RANGE_TOO_LONG_TEXT,
  SUMMARY_RANGE_USAGE_TEXT,
  YEAR_BAD_TEXT,
  YEAR_LOCKED_TEXT,
  yearEmptyText,
  SPLIT_UNAVAILABLE_TEXT,
  splitDoneText,
  NOTHING_TO_DELETE_TEXT,
  REFERRAL_BONUS_TEXT,
  REFERRAL_FAIL_TEXT,
  REFERRAL_OK_TEXT,
  referralShareText,
  SLIP_CANCELLED_TEXT,
  SLIP_SOON_TEXT,
  TOO_MANY_MESSAGES_TEXT,
  USE_CODE_USAGE_TEXT,
  VOICE_CANCELLED_TEXT,
  WALLET_AMBIGUOUS_TEXT,
  REMINDER_CANCELLED_TEXT,
  REMINDER_EMPTY_TEXT,
  REMINDER_FULL_TEXT,
  REMINDER_GONE_TEXT,
  REMINDER_NO_TEXT_TEXT,
  REMINDER_PAST_TEXT,
  REMINDER_TOO_FAR_TEXT,
  REMINDER_USAGE_TEXT,
  NOTE_EMPTY_TEXT,
  NOTE_FULL_TEXT,
  FILE_EXPIRED_TEXT,
  FILE_UNAVAILABLE_TEXT,
  FILE_VIDEO_ELSEWHERE_TEXT,
  NOTE_SAVED_TEXT,
  NOTE_SECRET_WARNING_TEXT,
  NOTE_SEARCH_USAGE_TEXT,
  NOTE_TOO_LONG_TEXT,
  NOTE_UNDONE_TEXT,
  noteListText,
  noteNotFoundText,
  WALLET_MOVE_ASK_TEXT,
  WALLET_SLIP_ASK_TEXT,
  WALLET_SLIP_MOVED_TEXT,
  WALLET_MOVED_TEXT,
  WALLET_NOT_FOUND_TEXT,
  CARD_LOCKED_TEXT,
  BILL_EMPTY_TEXT,
  BILL_EXISTS_TEXT,
  BILL_GONE_TEXT,
  BILL_LOCKED_TEXT,
  BILL_RECORDED_ALREADY_TEXT,
  BILL_SNOOZED_TEXT,
  BILL_USAGE_TEXT,
  billAmbiguousText,
  billFullText,
  SHARED_INVITE_OWNER_ONLY_TEXT,
  SHARED_JOIN_USAGE_TEXT,
  SHARED_OWNER_CANNOT_LEAVE_TEXT,
  SHARED_WALLET_LOCKED_TEXT,
  SHARED_WALLET_ONLY_ENTRIES_TEXT,
  sharedInviteText,
  sharedJoinedText,
  sharedLeftText,
  GOAL_BAD_DUE_TEXT,
  GOAL_EMPTY_TEXT,
  GOAL_EXISTS_TEXT,
  GOAL_LOCKED_TEXT,
  GOAL_UNDO_BLOCKED_TEXT,
  GOAL_UNDONE_TEXT,
  goalAmbiguousText,
  goalFullText,
  goalOverdrawText,
  DAILY_BUDGET_CLEARED_TEXT,
  DAILY_BUDGET_LOCKED_TEXT,
  DAILY_BUDGET_NONE_TEXT,
  DAILY_BUDGET_USAGE_TEXT,
  dailyBudgetSetText,
  DEBT_BAD_DUE_TEXT,
  FX_LOCKED_TEXT,
  DEBT_CANCELLED_TEXT,
  DEBT_EMPTY_TEXT,
  DEBT_LOCKED_TEXT,
  DEBT_TOO_MANY_TEXT,
  debtOverpayText,
  CARD_NONE_TEXT,
  CARD_NO_DETAIL_TEXT,
  TRANSFER_CANCELLED_TEXT,
  TRANSFER_LOCKED_TEXT,
  TRANSFER_SAME_TEXT,
  TRANSFER_USAGE_TEXT,
  VOICE_UNAVAILABLE_TEXT,
  PDF_ALREADY_DONE_TEXT,
  PDF_CANCELLED_TEXT,
  PDF_UNAVAILABLE_TEXT,
  pdfRecordedText,
  text,
} from "./messages";
import { log, safeMessage } from "@/lib/log";
import type { Transcriber } from "@/lib/voice/transcribe";
import { handleVoiceMessage, type VoiceDeps } from "./voice";

export interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { type: string; userId?: string; groupId?: string };
  message?: {
    type: string;
    id?: string;
    text?: string;
    duration?: number;
    /** File messages: the name and size LINE reports. */
    fileName?: string;
    fileSize?: number;
    /** Video messages: "line" when LINE holds the content, "external" when it is elsewhere. */
    contentProvider?: { type: string };
  };
  postback?: {
    data: string;
    /** Filled by the LINE date picker: { date: "2026-10-12" }. */
    params?: { date?: string; time?: string; datetime?: string };
  };
}

export interface HandlerDeps {
  db: SupabaseClient;
  reply: (replyToken: string, messages: LineMessage[]) => Promise<void>;
  getProfile: (lineUserId: string) => Promise<{ displayName?: string; pictureUrl?: string } | null>;
  /** A member's profile inside a group (works without being friends). Absent -> neutral names. */
  getGroupMemberProfile?: (
    groupId: string,
    lineUserId: string,
  ) => Promise<{ displayName?: string; pictureUrl?: string } | null>;
  now: () => Date;
  /** Per-user rate limiter (absent in tests -> no limiting). */
  limit?: (bucket: string, subject: string, rule: LimitRule) => Promise<RateLimitResult>;
  /** Slip reading (Phase 4). Absent -> image messages get a "coming soon" reply. */
  slip?: {
    fetchImage: (messageId: string) => Promise<SlipImage>;
    ocr: SlipOcrProvider;
  };
  /** AI that writes the AI Insight (Elite). Absent -> plain-code observations instead. */
  insightWriter?: InsightWriter;
  /** AI that reads long sentences (Elite). Absent -> the ordinary rules handle everything. */
  structurer?: TextStructurer;
  /** AI that sorts plain messages into groups. Absent -> the ordinary rules handle everything. */
  router?: IntentRouter;
  /** Kept files. Absent -> pictures and files behave as they did before the file store. */
  files?: {
    fetchFile: SaveDeps["fetchFile"];
    fetchPreview?: SaveDeps["fetchPreview"];
    store: SaveDeps["store"];
  };
  /** Voice messages. Absent (no AI key that hears audio) -> a polite "not available" reply. */
  voice?: {
    fetchAudio: VoiceDeps["fetchAudio"];
    transcriber: Transcriber;
  };
  /** พี่ฮูก, the AI assistant. Absent (no AI key) -> a polite "not available". */
  owl?: Owl;
  /** PDF files (statements, bills). Absent (no AI key) -> a polite "not available" reply. */
  pdf?: {
    fetchPdf: PdfDeps["fetchPdf"];
    reader: PdfReader;
  };
}

const UUID_RE = /^[0-9a-f-]{36}$/;
const MAX_REPLY_MESSAGES = 5;
const MAX_CARDS_PER_REPLY = 3;

export async function handleEvent(event: LineEvent, deps: HandlerDeps): Promise<void> {
  // A LINE group: the group ledger (Elite) has its own, separate handling.
  if (event.source?.type === "group") return handleGroupEvent(event, deps);

  const lineUserId = event.source?.userId;
  // Other than that, 1:1 chats only (multi-person "rooms" are not supported).
  if (!lineUserId || event.source?.type !== "user") return;

  // Spam / cost guard, before any database or paid-API work. Over the limit we answer once
  // (on the first excess hit of the window) and then stay quiet instead of flooding the chat.
  if (deps.limit && (event.type === "message" || event.type === "postback")) {
    const isImage = event.message?.type === "image" || event.message?.type === "video";
    const isAudio = event.message?.type === "audio";
    const isFile = event.message?.type === "file";
    const [bucket, rule] =
      event.type === "postback"
        ? (["postback", LIMITS.postback] as const)
        : isImage
          ? (["chat_image", LIMITS.chatImage] as const)
          : isAudio
            ? (["chat_voice", LIMITS.chatVoice] as const)
            : isFile
              ? deps.files
                ? (["chat_file", LIMITS.chatFile] as const)
                : (["chat_pdf", LIMITS.chatPdf] as const)
              : (["chat", LIMITS.chat] as const);
    const result = await deps.limit(bucket, lineUserId, rule);
    if (!result.allowed) {
      if (result.hits === result.limit + 1 && event.replyToken) {
        await deps.reply(event.replyToken, [text(TOO_MANY_MESSAGES_TEXT)]);
      }
      return;
    }
  }

  const user = await ensureUser(deps.db, lineUserId, () => deps.getProfile(lineUserId));
  const reply = async (messages: LineMessage[]) => {
    if (event.replyToken && messages.length > 0) {
      const { theme } = await prefsOf(deps, user);
      await deps.reply(event.replyToken, applyTheme(messages.slice(0, MAX_REPLY_MESSAGES), theme));
    }
  };

  switch (event.type) {
    case "follow":
      await reply([buildWelcomeCard({ appUrl: appBaseUrl() })]);
      return;
    case "message":
      if (event.message?.type === "text" && event.message.text !== undefined) {
        await reply(await handleText(event.message.text, user, deps));
      } else if (event.message?.type === "image") {
        const { slip } = deps;
        const files = fileChatDeps(deps);
        if (slip && event.message.id) {
          const media = {
            messageId: event.message.id,
            kind: "image" as const,
            fileName: null,
            fileSize: null,
          };
          // an image right after "แนบรูป" belongs to that entry, after "เก็บไฟล์" it is kept, and
          // everything else is a slip
          const wait = await getLivePhotoWait(deps.db, user.id, deps.now());
          const keep = !wait && files ? await takeFileWait(deps.db, user.id, deps.now()) : null;
          if (wait) {
            await reply(
              await handlePhotoImage(
                { db: deps.db, now: deps.now, fetchImage: slip.fetchImage },
                user,
                event.message.id,
                wait,
              ),
            );
          } else if (keep && files) {
            await reply(await saveWaitingFile(files, user, media, keep.name));
          } else {
            const remembered = files
              ? await rememberMedia(deps.db, user.id, media, deps.now()).catch((error: unknown) => {
                  log.warn("remember_media_failed", { reason: safeMessage(error) });
                  return null;
                })
              : null;
            await reply(
              await handleSlipImage(
                {
                  db: deps.db,
                  now: deps.now,
                  fetchImage: slip.fetchImage,
                  ocr: slip.ocr,
                  editUrl: (txId) => pageUrl(`/transactions?edit=${txId}`),
                  logoUrl: appBaseUrl() ? `${appBaseUrl()}/success-logo.png?v=2` : undefined,
                  extras: (made) => receiptCardExtras(deps, user, made),
                  onNotSlip: remembered ? async () => keepOffer(remembered) : undefined,
                  onRecorded: remembered
                    ? () =>
                        forgetMedia(deps.db, user.id, remembered).catch((error: unknown) =>
                          log.warn("forget_media_failed", { reason: safeMessage(error) }),
                        )
                    : undefined,
                },
                user,
                event.message.id,
              ),
            );
          }
        } else {
          await reply([text(SLIP_SOON_TEXT)]);
        }
      } else if (event.message?.type === "file" && event.message.id) {
        const files = fileChatDeps(deps);
        const message = {
          id: event.message.id,
          fileName: event.message.fileName,
          fileSize: event.message.fileSize,
        };
        if (files) {
          const media = {
            messageId: message.id,
            kind: "file" as const,
            fileName: message.fileName ?? null,
            fileSize: message.fileSize ?? null,
          };
          const keep = await takeFileWait(deps.db, user.id, deps.now());
          await reply(
            keep
              ? await saveWaitingFile(files, user, media, keep.name)
              : await handleIncomingFile(files, user, media),
          );
        } else {
          await reply(await readPdf(message, user, deps, lineUserId));
        }
      } else if (event.message?.type === "video" && event.message.id) {
        const files = fileChatDeps(deps);
        if (files) {
          if (event.message.contentProvider?.type === "external") {
            await reply([text(FILE_VIDEO_ELSEWHERE_TEXT)]);
            return;
          }
          const media = {
            messageId: event.message.id,
            kind: "video" as const,
            fileName: null,
            fileSize: null,
          };
          const keep = await takeFileWait(deps.db, user.id, deps.now());
          await reply(
            keep
              ? await saveWaitingFile(files, user, media, keep.name)
              : await offerToKeep(files, user, media),
          );
        }
      } else if (event.message?.type === "audio" && event.message.id) {
        const { voice } = deps;
        if (!voice) {
          await reply([text(VOICE_UNAVAILABLE_TEXT)]);
        } else {
          await reply(
            await handleVoiceMessage(
              {
                db: deps.db,
                now: deps.now,
                fetchAudio: voice.fetchAudio,
                transcriber: voice.transcriber,
                structurer: deps.structurer,
                route: deps.router
                  ? (heard, parsed) => routeText(heard, parsed, user, intentDeps(user, deps))
                  : undefined,
                limit: deps.limit,
              },
              user,
              { id: event.message.id, duration: event.message.duration },
              lineUserId,
            ),
          );
        }
      }
      return;
    case "postback":
      if (event.postback?.data)
        await reply(await handlePostback(event.postback.data, user, deps, event.postback.params));
      return;
    default:
      return;
  }
}

// ───────────────────────── text ─────────────────────────

/** The public app URL without a trailing slash, when it is configured. */
function appBaseUrl(): string | undefined {
  return process.env.APP_BASE_URL?.replace(/\/$/, "") || undefined;
}

/** Hand a file to the AI reader, which asks the plan and the quota first. */
async function readPdf(
  message: { id: string; fileName?: string; fileSize?: number },
  user: UserRow,
  deps: HandlerDeps,
  lineUserId: string,
): Promise<LineMessage[]> {
  const { pdf } = deps;
  if (!pdf) return [text(PDF_UNAVAILABLE_TEXT)];
  return handlePdfMessage(
    {
      db: deps.db,
      now: deps.now,
      fetchPdf: pdf.fetchPdf,
      reader: pdf.reader,
      limit: deps.limit,
    },
    user,
    message,
    lineUserId,
  );
}

/** What keeping a file needs from the handler's dependencies. Null without a file store. */
function fileChatDeps(deps: HandlerDeps): FileChatDeps | null {
  const { files } = deps;
  if (!files) return null;
  return {
    db: deps.db,
    now: deps.now,
    store: files.store,
    fetchFile: files.fetchFile,
    fetchPreview: files.fetchPreview,
    pageUrl,
  };
}

/** What sorting a plain message needs from the handler's dependencies. */
function intentDeps(user: UserRow, deps: HandlerDeps, inOwl = false): IntentDeps {
  return {
    db: deps.db,
    now: deps.now,
    router: deps.router,
    run: (command) => runCommand(command, user, deps),
    ask: (question) => owlAsk(owlDeps(deps), user, question, inOwl, user.line_user_id),
    recordMoney: (input) => handleText(input, user, deps, { routed: true, showCard: inOwl }),
    listUrl: pageUrl("/reminders"),
  };
}

/** What the assistant needs from the handler's dependencies. */
function owlDeps(deps: HandlerDeps): OwlDeps {
  return { db: deps.db, now: deps.now, owl: deps.owl, limit: deps.limit };
}

async function handleText(
  input: string,
  user: UserRow,
  deps: HandlerDeps,
  options: { routed?: boolean; showCard?: boolean } = {},
): Promise<LineMessage[]> {
  const command = parseCommand(input);
  if (command?.kind === "transfer") {
    // "โอนค่าเช่า 5000 ไป ..." that names no wallet is an ordinary entry, so it falls through
    const done = await runTransfer(command, user, deps);
    if (done) return done;
  } else if (
    command?.kind === "wallet-join" ||
    command?.kind === "wallet-invite" ||
    command?.kind === "wallet-leave"
  ) {
    // "เชิญ แม่" / "ออกจากกระเป๋า ..." that names no shared wallet of theirs is an ordinary message
    const done = await runSharedWallet(command, user, deps, user.line_user_id);
    if (done) return done;
  } else if (command?.kind === "bill-new" || command?.kind === "bill-pay") {
    // "จ่ายบิล ค่าน้ำมัน 500" that names none of their bills is an ordinary entry
    const done = await runBill(command, user, deps);
    if (done) return done;
  } else if (
    command?.kind === "goal-new" ||
    command?.kind === "goal-deposit" ||
    command?.kind === "goal-withdraw"
  ) {
    // "ออม ทอง 500" that names none of their goals is an ordinary entry
    const done = await runGoal(command, user, deps);
    if (done) return done;
  } else if (command?.kind === "debt-new" || command?.kind === "debt-pay") {
    // "สมชายคืน 200" with no such debt (or "ยืม..." that is not one) is an ordinary message
    const done = await runDebt(command, user, deps);
    if (done) return done;
  } else if (command?.kind === "cards") {
    // "บัตร จอดรถ" that names no card of theirs is not a command
    const done = await runCards(command, user, deps);
    if (done) return done;
  } else if (command) {
    return runCommand(command, user, deps);
  }

  const parsed = parseMessage(input, deps.now(), { currencies: true });

  // In พี่ฮูก mode (a few minutes after "ถามพี่ฮูก") the AI sorts everything typed: an action is done
  // here, and the rest is a question. A button already said what the message is, so that answer
  // goes straight to the money path.
  if (!options.routed && (await inOwlMode(owlDeps(deps), user))) {
    const owlIntents = intentDeps(user, deps, true);
    const replies =
      (await routeText(input, parsed, user, owlIntents, true)) ??
      (await owlIntents.recordMoney(input));
    return keepOwlOpen(owlDeps(deps), user, replies);
  }

  let { entries } = parsed;
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());

  // What the rules cannot be trusted with: the AI says whether it is money at all.
  if (
    !options.routed &&
    deps.router &&
    !entries.some((e) => e.foreign) &&
    needsRouter(input, parsed)
  ) {
    const routed = await routeText(input, parsed, user, intentDeps(user, deps));
    if (routed) return routed;
  }

  // Long or unclear sentences (Elite): let the AI read them, then ask before saving anything.
  if (
    deps.structurer &&
    can(plan, "smartParse") &&
    !looksSecret(input) &&
    !entries.some((e) => e.foreign) &&
    needsSmartParse(input, parsed)
  ) {
    const smart = await readWithAi(input, user, deps);
    if (smart) return smart;
  }

  if (entries.length === 0) return [notUnderstood()];
  // "ราเมน 1500 JPY": convert to baht first (Elite); everything after sees plain baht entries
  if (entries.some((e) => e.foreign)) {
    if (!can(plan, "foreignCurrency")) return [text(FX_LOCKED_TEXT)];
    const converted = await convertForeignEntries(entries, deps);
    if (typeof converted === "string") return [text(converted)];
    entries = converted;
  }
  if (entries.some((e) => e.backdated) && !can(plan, "backdate")) {
    // Nothing is saved; the card offers the upgrade, or recording it as today instead.
    return upsellReply(deps.db, user.id, deps.now(), "backdate", BACKDATE_LOCKED_TEXT, input);
  }
  if (entries.length > 1 && !can(plan, "multiEntry")) return [text(MULTI_ENTRY_LOCKED_TEXT)];
  if (entries.some((e) => e.tags.length > 0) && !can(plan, "tags")) {
    return [text(TAGS_LOCKED_TEXT)];
  }
  // "@บัตร": find each named wallet first, and record nothing if one cannot be told apart
  const walletIds = new Map<ParsedEntry, string>();
  if (entries.some((e) => e.walletHint)) {
    const wallets = await ensureWallets(deps.db, user.id);
    for (const e of entries) {
      if (!e.walletHint) continue;
      const found = resolveWallet(e.walletHint, wallets);
      if (!found.ok) {
        const names =
          found.reason === "ambiguous"
            ? wallets
                .filter((w) => w.name.toLowerCase().startsWith(e.walletHint!.toLowerCase()))
                .map((w) => w.name)
            : wallets.map((w) => w.name);
        return [
          text(
            found.reason === "ambiguous"
              ? WALLET_AMBIGUOUS_TEXT(e.walletHint, names)
              : WALLET_NOT_FOUND_TEXT(e.walletHint, names),
          ),
        ];
      }
      walletIds.set(e, found.wallet.id);
    }
  }
  return saveEntries(entries, user, deps, walletIds, options.showCard);
}

/** Wallet balance as text, e.g. "เงินสด คงเหลือ ฿9,500". */
async function balanceLine(deps: HandlerDeps, userId: string, walletId: string): Promise<string> {
  const wallets = await listWallets(deps.db, userId);
  const w = wallets.find((x) => x.id === walletId);
  return w ? `${w.name} คงเหลือ ฿${formatBaht(balanceOf(w))}` : "";
}

/** Lend / borrow / repay by chat. null when it is not about a debt of theirs (then it is an ordinary message). */
async function runDebt(
  command: Extract<Command, { kind: "debt-new" | "debt-pay" }>,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  const ultimate = can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "debts");

  if (command.kind === "debt-pay") {
    if (!ultimate) return null;
    const debts = await listDebts(db, user.id);
    const open = openDebtsOf(debts, command.person, command.direction);
    if (open.length === 0) return null;
    const plan = planPayment(
      open.map((d) => ({ id: d.id, remainingSatang: d.remainingSatang })),
      command.amountSatang,
    );
    const person = cleanPerson(open[0]?.person ?? command.person);
    if (!plan.ok) return [text(debtOverpayText(person, formatBaht(plan.owedSatang)))];

    const wallets = await ensureWallets(db, user.id);
    let wallet =
      wallets.find((w) => w.id === open[0]?.accountId) ?? wallets.find((w) => w.isDefault);
    if (command.walletHint) {
      const found = resolveWallet(command.walletHint, wallets);
      if (!found.ok) {
        const names = wallets.map((w) => w.name);
        return [
          text(
            found.reason === "ambiguous"
              ? WALLET_AMBIGUOUS_TEXT(command.walletHint, names)
              : WALLET_NOT_FOUND_TEXT(command.walletHint, names),
          ),
        ];
      }
      if (found.wallet.shared) return [text(SHARED_WALLET_ONLY_ENTRIES_TEXT)];
      wallet = found.wallet;
    }
    if (!wallet) return null;

    const ids = await addPayments(db, user.id, plan.parts, {
      accountId: wallet.id,
      paidAt: deps.now(),
    });
    const left = open.reduce((s, d) => s + d.remainingSatang, 0) - command.amountSatang;
    return [
      buildDebtDone({
        undoData: `a=dpx&id=${ids.join(",")}`,
        text: [
          command.direction === "lent"
            ? `รับคืนจาก ${person} ฿${formatBaht(command.amountSatang)}`
            : `คืนเงิน ${person} ฿${formatBaht(command.amountSatang)}`,
          left > 0 ? `ยังเหลือ ฿${formatBaht(left)}` : "ปิดหนี้ครบแล้ว 🎉",
          await balanceLine(deps, user.id, wallet.id),
          "(ไม่นับเป็นรายรับ/รายจ่าย)",
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    ];
  }

  if (!ultimate) return [text(DEBT_LOCKED_TEXT)];
  const wallets = await ensureWallets(db, user.id);
  let wallet = wallets.find((w) => w.isDefault);
  if (command.walletHint) {
    const found = resolveWallet(command.walletHint, wallets);
    if (!found.ok) {
      const names = wallets.map((w) => w.name);
      return [
        text(
          found.reason === "ambiguous"
            ? WALLET_AMBIGUOUS_TEXT(command.walletHint, names)
            : WALLET_NOT_FOUND_TEXT(command.walletHint, names),
        ),
      ];
    }
    if (found.wallet.shared) return [text(SHARED_WALLET_ONLY_ENTRIES_TEXT)];
    wallet = found.wallet;
  }
  if (!wallet) return null;

  let dueAt: Date | null = null;
  if (command.due) {
    dueAt = resolveDue(command.due, deps.now());
    if (!dueAt) return [text(DEBT_BAD_DUE_TEXT)];
  }
  const existing = await listDebts(db, user.id);
  if (
    openDebtsOf(existing, command.person, command.direction).length >= MAX_OPEN_DEBTS_PER_PERSON
  ) {
    return [text(DEBT_TOO_MANY_TEXT)];
  }

  const id = await createDebt(db, user.id, {
    direction: command.direction,
    person: command.person,
    amountSatang: command.amountSatang,
    accountId: wallet.id,
    occurredAt: deps.now(),
    dueAt,
  });
  const person = cleanPerson(command.person);
  return [
    buildDebtDone({
      undoData: `a=dx&id=${id}`,
      text: [
        command.direction === "lent"
          ? `จดแล้ว: ให้ ${person} ยืม ฿${formatBaht(command.amountSatang)}`
          : `จดแล้ว: ยืม ${person} ฿${formatBaht(command.amountSatang)}`,
        dueAt ? `กำหนดคืน ${formatThaiDate(dueAt)}` : "",
        await balanceLine(deps, user.id, wallet.id),
        "(ไม่นับเป็นรายรับ/รายจ่าย)",
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  ];
}

/** Join with an invite code / invite somebody / leave a shared wallet. */
async function runSharedWallet(
  command: Extract<Command, { kind: "wallet-join" | "wallet-invite" | "wallet-leave" }>,
  user: UserRow,
  deps: HandlerDeps,
  lineUserId: string,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());

  if (command.kind === "wallet-join") {
    if (!command.code) return [text(SHARED_JOIN_USAGE_TEXT)];
    // a 6-digit code can be guessed, so wrong tries are limited per person
    if (deps.limit) {
      const tries = await deps.limit("join_wallet", lineUserId, LIMITS.joinWallet);
      if (!tries.allowed) return [text(TOO_MANY_MESSAGES_TEXT)];
    }
    const result = await redeemInvite(db, command.code, user.id, deps.now());
    if (!result.ok) return [text(JOIN_FAIL_TEXT[result.reason])];
    return [text(sharedJoinedText(result.wallet.name))];
  }

  const wallets = await listWallets(db, user.id);
  if (command.kind === "wallet-invite") {
    const mine = wallets.filter((w) => w.shared && w.ownerId === user.id);
    if (mine.length === 0) {
      // someone without a shared wallet of their own typing "เชิญ ..." most likely means something else
      const theirs = wallets.filter((w) => w.shared);
      const found = resolveWallet(command.name, theirs);
      return found.ok ? [text(SHARED_INVITE_OWNER_ONLY_TEXT)] : null;
    }
    const found = resolveWallet(command.name, mine);
    if (!found.ok) {
      return found.reason === "ambiguous"
        ? [
            text(
              WALLET_AMBIGUOUS_TEXT(
                command.name,
                mine.map((w) => w.name),
              ),
            ),
          ]
        : null;
    }
    if (!can(plan, "sharedWallet")) return [text(SHARED_WALLET_LOCKED_TEXT)];
    if ((await membersOf(db, found.wallet.id)).length >= sharedMemberLimit(plan)) {
      return [text(JOIN_FAIL_TEXT.full)];
    }
    const invite = await createInvite(db, found.wallet.id, user.id, deps.now());
    return [text(sharedInviteText(found.wallet.name, invite.code))];
  }

  // leave
  const shared = wallets.filter((w) => w.shared);
  const found = resolveWallet(command.name, shared);
  if (!found.ok) return null;
  if (found.wallet.ownerId === user.id) return [text(SHARED_OWNER_CANNOT_LEAVE_TEXT)];
  await removeMember(db, found.wallet.id, user.id);
  return [text(sharedLeftText(found.wallet.name))];
}

/** "<d>/<m>/<y พ.ศ.>" for a YYYY-MM-DD date. */
const billDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${d}/${m}/${(y ?? 1970) + 543}`;
};

/** New bill / "จ่ายบิล <ชื่อ>". null when it is not about a bill of theirs (then an ordinary message). */
async function runBill(
  command: Extract<Command, { kind: "bill-new" | "bill-pay" }>,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  const allowed = can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "billReminder");
  if (command.kind === "bill-new" && !allowed) return [text(BILL_LOCKED_TEXT)];
  if (!allowed) return null;
  const today = billTodayKey(deps.now());
  const bills = await listBills(db, user.id);

  if (command.kind === "bill-new") {
    if (bills.length >= MAX_ACTIVE_BILLS) return [text(billFullText(MAX_ACTIVE_BILLS))];
    const nextDueOn = firstDue(command.cadence, command.dayOfMonth, command.monthOfYear, today);
    const id = await createBill(db, user.id, { ...command, nextDueOn });
    if (id === "duplicate") return [text(BILL_EXISTS_TEXT)];
    const cadence =
      command.cadence === "monthly"
        ? `ทุกเดือนวันที่ ${command.dayOfMonth}`
        : command.cadence === "yearly"
          ? `ทุกปี ${command.dayOfMonth}/${command.monthOfYear}`
          : "ครั้งเดียว";
    return [
      text(
        [
          `ตั้งเตือนบิลแล้ว: ${command.name}${command.amountSatang ? ` ประมาณ ฿${formatBaht(command.amountSatang)}` : ""}`,
          `${cadence} · ครบถัดไป ${billDate(nextDueOn)}`,
          `เตือน ${command.remindDays.map((d) => (d === 0 ? "ในวันนั้น" : `ก่อน ${d} วัน`)).join(" และ ")} เวลา ${String(command.remindHour).padStart(2, "0")}:00 น.`,
        ].join("\n"),
      ),
    ];
  }

  const found = resolveBill(command.name, bills);
  if (!found.ok) {
    if (found.reason === "none") return null;
    const names = bills
      .filter((b) => b.name.toLowerCase().startsWith(command.name.toLowerCase()))
      .map((b) => b.name);
    return [text(billAmbiguousText(command.name, names))];
  }
  return billPaid(found.bill, user, deps, true);
}

/** Paid (or skipped) a bill: move it on, and offer to record the expense when it has an amount. */
async function billPaid(
  bill: import("@/lib/bill").BillDto,
  user: UserRow,
  deps: HandlerDeps,
  paid: boolean,
): Promise<LineMessage[]> {
  const { nextDueOn } = await settleBill(deps.db, user.id, bill, deps.now());
  const lines = [
    paid ? `จ่าย${bill.name}แล้ว` : `ข้ามรอบนี้ของ${bill.name}แล้ว`,
    nextDueOn ? `ครบกำหนดรอบถัดไป ${billDate(nextDueOn)}` : "บิลนี้ครั้งเดียว ปิดให้แล้ว",
  ];
  const message: LineMessage = { type: "text", text: lines.join("\n") };
  if (paid && bill.amountSatang) {
    message.quickReply = {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: `📝 จดรายจ่าย ฿${formatBaht(bill.amountSatang)}`.slice(0, 20),
            data: `a=be&id=${bill.id}&d=${bill.nextDueOn}`,
            displayText: "จดเป็นรายจ่าย",
          },
        },
      ],
    };
  }
  return [message];
}

/** New goal / put in / take out. null when it is not about a goal of theirs (then an ordinary message). */
async function runGoal(
  command: Extract<Command, { kind: "goal-new" | "goal-deposit" | "goal-withdraw" }>,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
  const allowed = can(plan, "savingsGoal");
  if (command.kind === "goal-new" && !allowed) return [text(GOAL_LOCKED_TEXT)];
  if (!allowed) return null;

  const goals = (await listGoals(db, user.id, deps.now())).filter((g) => !g.archived);

  if (command.kind === "goal-new") {
    if (goals.length >= goalCapacity(plan)) return [text(goalFullText(goalCapacity(plan)))];
    const dueOn = command.due ? dueSpecToDate(command.due, (s) => resolveDue(s, deps.now())) : null;
    if (command.due && !dueOn) return [text(GOAL_BAD_DUE_TEXT)];
    const id = await createGoal(db, user.id, {
      name: command.name,
      targetSatang: command.targetSatang,
      dueOn,
    });
    if (id === "duplicate") return [text(GOAL_EXISTS_TEXT)];
    return [
      text(
        [
          `สร้างเป้าหมายแล้ว: ${command.name} ฿${formatBaht(command.targetSatang)}`,
          dueOn ? `ภายใน ${dueOn.split("-").reverse().join("/")}` : "",
          `หยอดกระปุกด้วย "ออม ${command.name} 1000" ได้เลย`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ];
  }

  const found = resolveGoal(command.name, goals);
  if (!found.ok) {
    if (found.reason === "none") return null;
    const names = goals
      .filter((g) => g.name.toLowerCase().startsWith(command.name.toLowerCase()))
      .map((g) => g.name);
    return [text(goalAmbiguousText(command.name, names))];
  }
  const goal = found.goal;
  const out = command.kind === "goal-withdraw";
  if (out && command.amountSatang > goal.savedSatang) {
    return [text(goalOverdrawText(goal.name, formatBaht(goal.savedSatang)))];
  }

  const depositId = await addDeposit(db, user.id, goal.id, {
    amountSatang: out ? -command.amountSatang : command.amountSatang,
    occurredAt: deps.now(),
  });
  const saved = goal.savedSatang + (out ? -command.amountSatang : command.amountSatang);
  const after = {
    ...goal,
    savedSatang: saved,
    ...goalProgress({ ...goal, savedSatang: saved }, deps.now()),
  };
  const reached = !goal.done && after.done;
  const messages: LineMessage[] = [
    buildGoalDone({
      undoData: `a=gx&id=${depositId}&g=${goal.id}`,
      text: [
        out
          ? `ถอนแล้ว ฿${formatBaht(command.amountSatang)} จาก ${goal.name}`
          : `หยอดแล้ว ฿${formatBaht(command.amountSatang)} → ${goal.name}`,
        `สะสม ฿${formatBaht(saved)} จาก ฿${formatBaht(goal.targetSatang)} (${after.percent}%)`,
        after.done ? "ครบเป้าแล้ว" : `เหลืออีก ฿${formatBaht(after.remainingSatang)}`,
      ].join("\n"),
    }),
  ];
  if (reached) messages.push(buildGoalReachedCard(after));
  return messages;
}

/** The daily limit in satang when they have one and their plan allows it, else null. */
async function dailyLimitOf(user: UserRow, deps: HandlerDeps): Promise<number | null> {
  if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "dailyBudget")) return null;
  const settings = await getSettings(deps.db, user.id);
  return settings.daily_budget === null || settings.daily_budget === undefined
    ? null
    : toSatang(settings.daily_budget);
}

async function saveDailyBudget(deps: HandlerDeps, userId: string, satang: number | null) {
  const { error } = await deps.db
    .from("user_settings")
    .upsert(
      { user_id: userId, daily_budget: satang === null ? null : satangToString(satang) },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`save daily budget: ${error.message}`);
}

/** "บัตร": the card summary. null when a typed name matches none of their cards. */
async function runCards(
  command: Extract<Command, { kind: "cards" }>,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[] | null> {
  const wallets = await ensureWallets(deps.db, user.id);
  let cards = wallets.filter((w) => w.kind === "card");
  if (command.name) {
    const found = resolveWallet(command.name, cards);
    if (!found.ok) return null;
    cards = [found.wallet];
  }
  if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "creditCard")) {
    return [text(CARD_LOCKED_TEXT)];
  }
  if (cards.length === 0) return [text(CARD_NONE_TEXT)];
  const statuses = await loadCardStatuses(deps.db, user.id, cards, deps.now());
  const shown = cards.flatMap((wallet) => {
    const status = statuses.get(wallet.id);
    return status ? [{ wallet, status }] : [];
  });
  if (shown.length === 0) return [text(CARD_NO_DETAIL_TEXT)];
  return [buildCardsCard({ cards: shown, manageUrl: pageUrl("/wallets") })];
}

/**
 * 80% / 100% of a card's limit: after expenses were saved to cards, warn when the amount owed
 * crossed a line. Entries to the same card in one message are added up first.
 */
async function cardLimitAlerts(
  deps: HandlerDeps,
  user: UserRow,
  spent: { walletId: string | null; amountSatang: number }[],
): Promise<string[]> {
  if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "creditCard")) return [];
  try {
    const wallets = await listWallets(deps.db, user.id);
    const main = wallets.find((w) => w.isDefault);
    const totals = new Map<string, number>();
    for (const s of spent) {
      const id = s.walletId ?? main?.id;
      if (id) totals.set(id, (totals.get(id) ?? 0) + s.amountSatang);
    }
    const out: string[] = [];
    for (const [id, amount] of totals) {
      const wallet = wallets.find((w) => w.id === id);
      const alert = wallet ? limitAlert(wallet, amount) : null;
      if (alert) out.push(alert);
    }
    return out;
  } catch (error) {
    log.error("card_alert_failed", error);
    return [];
  }
}

/** "โอน 500 เงินสด>KTC": null when neither name is a wallet of theirs (then it is not a transfer). */
async function runTransfer(
  command: Extract<Command, { kind: "transfer" }>,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[] | null> {
  const wallets = await ensureWallets(deps.db, user.id);
  const from = resolveWallet(command.from, wallets);
  const to = resolveWallet(command.to, wallets);
  if (!from.ok && !to.ok && from.reason === "none" && to.reason === "none") return null;
  // transfers use private wallets only (a shared one takes income / expenses)
  if ((from.ok && from.wallet.shared) || (to.ok && to.wallet.shared)) {
    return [text(SHARED_WALLET_ONLY_ENTRIES_TEXT)];
  }

  if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "transfer")) {
    return [text(TRANSFER_LOCKED_TEXT)];
  }
  for (const [side, hint] of [
    [from, command.from],
    [to, command.to],
  ] as const) {
    if (!side.ok) {
      const names = wallets.map((w) => w.name);
      return [
        text(
          side.reason === "ambiguous"
            ? WALLET_AMBIGUOUS_TEXT(hint, names)
            : WALLET_NOT_FOUND_TEXT(hint, names),
        ),
      ];
    }
  }
  if (!from.ok || !to.ok) return null;
  if (from.wallet.id === to.wallet.id) return [text(TRANSFER_SAME_TEXT)];

  const id = await createTransfer(deps.db, user.id, {
    fromId: from.wallet.id,
    toId: to.wallet.id,
    amountSatang: command.amountSatang,
    occurredAt: deps.now(),
  });
  const after = await listWallets(deps.db, user.id);
  const balance = (walletId: string) => {
    const w = after.find((x) => x.id === walletId);
    return w ? `฿${formatBaht(balanceOf(w))}` : "";
  };
  return [
    buildTransferDone({
      transferId: id,
      text: [
        `โอนแล้ว ฿${formatBaht(command.amountSatang)}`,
        `${walletLabel(from.wallet)} → ${walletLabel(to.wallet)}`,
        `คงเหลือ: ${from.wallet.name} ${balance(from.wallet.id)} · ${to.wallet.name} ${balance(to.wallet.id)}`,
        "(ไม่นับเป็นรายรับ/รายจ่าย)",
      ].join("\n"),
    }),
  ];
}

/** "🐱 ค่าอาหารแมว" for a category that has an emoji, its plain name otherwise, null for none. */
function categoryLabelOf(c: { name: string; icon?: string | null } | undefined): string | null {
  return c ? categoryLabel(c.name, c.icon) : null;
}

/** A page of the web app, through the LIFF link inside LINE (undefined when no address is known). */
function pageUrl(path: string): string | undefined {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}${path}`;
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : undefined;
}

/**
 * Link that opens the entries list with a search already typed: inside LINE it goes through the
 * LIFF link (which keeps the path and query), otherwise the plain app URL.
 */
function listUrl(term: string): string | undefined {
  const query = term ? `?q=${encodeURIComponent(term)}` : "";
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}/transactions${query}`;
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/transactions${query}` : undefined;
}

/** The card for a custom range (typed or picked), or the text that says what is wrong with it. */
async function summaryForRange(
  user: UserRow,
  deps: HandlerDeps,
  start: DaySpec,
  end: DaySpec | null,
  title = "สรุปช่วงที่เลือก",
): Promise<LineMessage[]> {
  const result = resolveRange(start, end, deps.now());
  if (!result.ok) {
    return [
      text(
        result.reason === "order"
          ? SUMMARY_RANGE_ORDER_TEXT
          : result.reason === "too_long"
            ? SUMMARY_RANGE_TOO_LONG_TEXT
            : SUMMARY_RANGE_BAD_DATE_TEXT,
      ),
    ];
  }
  const subtitle = `${formatThaiDate(result.range.from)} – ${formatThaiDate(result.lastDay)} (${result.days} วัน)`;
  const data = await loadSummaryData(deps.db, user.id, result.range, result.previous);
  if (data.current.count === 0) return [text(`${title}\n${subtitle}\nยังไม่มีรายการเลย`)];
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  return [
    buildSummaryCard({
      title,
      range: result.range,
      data,
      against: "ช่วงก่อนหน้า",
      subtitle,
      liffUrl: base ? `${base}/summary` : undefined,
    }),
  ];
}

/** A day from the LINE date picker ("2026-10-12"): real, not in the future, within a year. */
export function backdateFromPicker(
  value: string | undefined,
  now: Date,
): { iso: string; thai: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  if (!isValidYmd(year, month, day)) return null;
  const at = fromBangkok(year, month, day);
  const today = bangkokParts(now);
  if (at.getTime() > fromBangkok(today.year, today.month, today.day, 23, 59).getTime()) return null;
  if (now.getTime() - at.getTime() > (BACKDATE_MAX_DAYS + 1) * 86_400_000) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, thai: formatThaiDate(at) };
}

/** AI reading of a message: pending entries + check cards, or null to fall back to the rules. */
async function readWithAi(
  input: string,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  const [categories, memory] = await Promise.all([
    loadCategories(db, user.id),
    loadMemoryFor(db, user, deps.now()),
  ]);
  const entries = await runSmartParse(
    { structurer: deps.structurer, limit: deps.limit, now: deps.now },
    {
      text: input,
      subject: user.line_user_id,
      cap: { db, userId: user.id },
      categories: categories
        .filter((c) => !c.is_hidden)
        .map((c) => ({ name: c.name, type: c.type })),
    },
  );
  if (!entries) return null;
  const cards = await recordSmartEntries({
    db,
    user,
    entries,
    categories,
    memory,
    rawText: input,
    source: "text",
  });
  return [text(SMART_PREFACE_TEXT), ...cards];
}

/**
 * What the card of a slip / receipt carries under its rows, like the card of a typed entry: the
 * budget(s) these entries count against with the warning when they crossed a line, the daily-limit
 * and card-limit warnings, and the "จ่ายด้วย" row (moves the whole slip). Never throws past a
 * failed part: each part is best effort.
 */
async function receiptCardExtras(
  deps: HandlerDeps,
  user: UserRow,
  made: TxRow[],
): Promise<SlipCardExtras> {
  const { db } = deps;
  const now = deps.now();
  const extras: SlipCardExtras = { budgets: [], notices: [] };
  const first = made[0];
  if (!first) return extras;

  try {
    const [settings, mode] = await Promise.all([
      getSettings(db, user.id),
      getBudgetMode(db, user.id).catch(() => "overall" as const),
    ]);
    extras.cycleLabel =
      settings.budget_cycle === "weekly"
        ? "รายสัปดาห์"
        : `รายเดือน (วันที่ ${settings.cycle_start_day})`;
    // the budget an entry counts against: the overall one, or its category's
    const scopes = new Map<string, { categoryId: string | null; satang: number }>();
    for (const t of made) {
      const key = mode === "category" ? (t.category_id ?? "none") : "all";
      const scope = scopes.get(key) ?? { categoryId: t.category_id, satang: 0 };
      scope.satang += txAmountSatang(t);
      scopes.set(key, scope);
    }
    for (const scope of [...scopes.values()].slice(0, 3)) {
      const reading = await budgetReadingFor(db, {
        userId: user.id,
        type: "expense",
        categoryId: scope.categoryId,
        amountSatang: scope.satang,
        occurredAt: new Date(first.occurred_at),
        now,
      });
      if (!reading) continue;
      extras.budgets?.push(reading.status);
      if (reading.notice) {
        extras.notices?.push({
          text: reading.notice,
          level: reading.status.level === "over" ? "over" : "warn",
        });
      }
    }
  } catch (error) {
    log.error("slip_budget_status_failed", error);
  }

  const others = [
    ...(await safeDailyAlerts(
      deps,
      user.id,
      made.map((tx) => ({ tx })),
    )),
    ...(await cardLimitAlerts(
      deps,
      user,
      made.map((t) => ({ walletId: null, amountSatang: txAmountSatang(t) })),
    )),
  ];
  for (const text of others) extras.notices?.push({ text, level: "warn" });

  try {
    const wallets = await listWallets(db, user.id);
    const main = wallets.find((w) => w.isDefault) ?? wallets[0];
    if (main && can(effectivePlan(user.plan, user.plan_expires_at, now), "multiAccount")) {
      const { choices, more } = walletPills(wallets, main);
      extras.payment = { choices, more, addUrl: pageUrl("/wallets") };
    }
  } catch (error) {
    log.error("slip_wallets_failed", error);
  }

  extras.after = await awardAndNotify(deps, user.id);
  return extras;
}

async function saveEntries(
  entries: ParsedEntry[],
  user: UserRow,
  deps: HandlerDeps,
  walletIds: Map<ParsedEntry, string> = new Map(),
  showCard = false,
): Promise<LineMessage[]> {
  const { db } = deps;
  const [settings, categories, memory] = await Promise.all([
    getSettings(db, user.id),
    loadCategories(db, user.id),
    loadMemoryFor(db, user, deps.now()),
  ]);

  const confirmed: {
    tx: TxRow;
    entry: ParsedEntry;
    categoryId: string | null;
    walletId: string | null;
  }[] = [];
  const pending: { tx: TxRow; entry: ParsedEntry }[] = [];

  for (const parsed of entries) {
    // A title that starts with a category name ("อาหาร 50", picked from the quick-reply list)
    // settles both the category and whether it is income or expense.
    const chosen = matchLeadingCategory(parsed.title, parsed.type, categories);
    const entry: ParsedEntry = chosen
      ? {
          ...parsed,
          type: chosen.type,
          confidence:
            parsed.amountSatang >= LARGE_AMOUNT_SATANG
              ? parsed.confidence
              : Math.max(parsed.confidence, CONFIRM_THRESHOLD),
        }
      : parsed;
    const categoryId = chosen
      ? chosen.id
      : categorizeByRules({ title: entry.title, type: entry.type, categories, memory }).categoryId;
    const needsConfirm = entry.confidence < CONFIRM_THRESHOLD;
    const tx = await insertTransaction(db, {
      userId: user.id,
      type: entry.type,
      title: entry.title,
      amountSatang: entry.amountSatang,
      categoryId,
      occurredAt: entry.occurredAt,
      status: needsConfirm ? "pending_confirm" : "confirmed",
      rawText: entry.raw,
      tags: entry.tags,
      accountId: walletIds.get(parsed) ?? null,
      foreign: parsed.fx
        ? { currency: parsed.fx.currency, minor: parsed.fx.minor, rate: parsed.fx.rate }
        : null,
    });
    if (needsConfirm) pending.push({ tx, entry });
    else confirmed.push({ tx, entry, categoryId, walletId: walletIds.get(parsed) ?? null });
  }

  const messages: LineMessage[] = [];

  // With the full card the warnings (budget, daily limit, card limit) ride on the card itself, so
  // none is sent as a separate message. Other styles have no card to carry them.
  const embed =
    settings.confirm_style === "full" &&
    confirmed.length > 0 &&
    confirmed.length <= MAX_CARDS_PER_REPLY;
  let cardWarned = false;
  if (embed) {
    const mode = await getBudgetMode(db, user.id).catch(() => "overall" as const);
    // the budget an entry counts against: the overall one, or its category's
    const scopeOf = (c: (typeof confirmed)[number]): string | null =>
      c.entry.type !== "expense" ? null : mode === "category" ? (c.categoryId ?? "none") : "all";
    const totals = new Map<string, number>();
    const lastOf = new Map<string, number>();
    confirmed.forEach((c, i) => {
      const key = scopeOf(c);
      if (key === null) return;
      totals.set(key, (totals.get(key) ?? 0) + c.entry.amountSatang);
      lastOf.set(key, i);
    });
    // the daily and card-limit warnings go on the last card
    const others = [
      ...(await safeDailyAlerts(deps, user.id, confirmed)),
      ...(await cardLimitAlerts(
        deps,
        user,
        confirmed
          .filter((c) => c.entry.type === "expense")
          .map((c) => ({ walletId: c.walletId, amountSatang: c.entry.amountSatang })),
      )),
    ].map((t) => ({ text: t, level: "warn" as const }));
    for (const [i, c] of confirmed.entries()) {
      const key = scopeOf(c);
      const out = { noticed: false };
      messages.push(
        await confirmCard(
          c.tx,
          c.categoryId,
          categories,
          settings,
          user,
          deps,
          c.entry.tags,
          c.walletId,
          c.entry.fx ? fxNoteOf(c.entry.fx) : null,
          false,
          {
            batchSatang: key === null ? undefined : totals.get(key),
            // one budget warning per budget, on the last card that counts against it
            budgetNotice: key === null ? undefined : lastOf.get(key) === i,
            notices: i === confirmed.length - 1 ? others : undefined,
            out,
          },
        ),
      );
      cardWarned ||= out.noticed;
    }
  } else if ((showCard || settings.confirm_style !== "off") && confirmed.length > 0) {
    if (confirmed.length <= MAX_CARDS_PER_REPLY) {
      for (const c of confirmed) {
        messages.push(
          await confirmCard(
            c.tx,
            c.categoryId,
            categories,
            settings,
            user,
            deps,
            c.entry.tags,
            c.walletId,
            c.entry.fx ? fxNoteOf(c.entry.fx) : null,
          ),
        );
      }
    } else {
      const lines = confirmed.map(
        (c) =>
          `• ${c.entry.title} ${c.entry.type === "income" ? "+" : "-"}฿${formatBaht(c.entry.amountSatang)}`,
      );
      messages.push(text([`จดแล้ว ${confirmed.length} รายการ`, ...lines].join("\n")));
    }
  }

  for (const p of pending) {
    messages.push(
      buildTypeQuestion({ txId: p.tx.id, title: p.tx.title, amountSatang: p.entry.amountSatang }),
    );
  }

  // Budget alerts go last so they are the freshest thing in the chat (even with cards turned off).
  const alerts: string[] = [];
  if (!embed) {
    for (const c of confirmed) {
      alerts.push(...(await safeAlerts(deps, user.id, c.tx, c.categoryId)));
    }
    alerts.push(...(await safeDailyAlerts(deps, user.id, confirmed)));
    alerts.push(
      ...(await cardLimitAlerts(
        deps,
        user,
        confirmed
          .filter((c) => c.entry.type === "expense")
          .map((c) => ({ walletId: c.walletId, amountSatang: c.entry.amountSatang })),
      )),
    );
  }
  for (const a of alerts) messages.push(text(a));
  // A friendly / cheering manner adds one line after a plain save (never on top of a budget warning).
  const first = confirmed[0];
  if (first && alerts.length === 0 && !cardWarned && messages.length < MAX_REPLY_MESSAGES) {
    const quip = savedQuip(
      (await prefsOf(deps, user)).persona,
      confirmed.some((c) => c.entry.type === "expense") ? "expense" : "income",
    );
    if (quip) messages.push(text(quip));
  }
  if (confirmed.length > 0) messages.push(...(await awardAndNotify(deps, user.id)));
  return messages;
}

/**
 * Turn a pending receipt into one confirmed entry per product line (plus a remainder line when the
 * lines come to less than the total). The pending entry is claimed first, so a double tap splits once;
 * if anything fails afterwards the receipt goes back to waiting and the partial entries are removed.
 */
async function splitReceipt(tx: TxRow, user: UserRow, deps: HandlerDeps): Promise<LineMessage[]> {
  const { db } = deps;
  if (tx.status !== "pending_confirm" || !tx.slip_id) return [text(NOT_FOUND_TEXT)];
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
  if (plan !== "ultimate") return [text(SPLIT_LOCKED_TEXT)];

  const split = planReceiptSplit(txAmountSatang(tx), await getSlipItems(db, user.id, tx.slip_id));
  if (!split.ok) return [text(SPLIT_UNAVAILABLE_TEXT)];

  const claimed = await claimPendingTransaction(db, user.id, tx.id);
  if (!claimed) return [text(NOT_FOUND_TEXT)];

  const created: TxRow[] = [];
  try {
    const [categories, memory] = await Promise.all([
      loadCategories(db, user.id),
      loadMemoryFor(db, user, deps.now()),
    ]);
    for (const line of split.lines) {
      const { categoryId } = categorizeByRules({
        title: line.name,
        type: tx.type,
        categories,
        memory,
      });
      created.push(
        await insertTransaction(db, {
          userId: user.id,
          type: tx.type,
          title: line.name,
          amountSatang: line.amountSatang,
          categoryId,
          occurredAt: new Date(tx.occurred_at),
          status: "confirmed",
          rawText: line.name,
          source: "slip",
          slipId: tx.slip_id,
        }),
      );
    }
    const messages: LineMessage[] = [
      text(
        splitDoneText(
          split.lines.map((l) => ({ title: l.name, amountBaht: formatBaht(l.amountSatang) })),
          formatBaht(txAmountSatang(tx)),
        ),
      ),
    ];
    for (const t of created) {
      for (const alert of await safeAlerts(deps, user.id, t, t.category_id)) {
        messages.push(text(alert));
      }
    }
    messages.push(...(await awardAndNotify(deps, user.id)));
    return messages;
  } catch (error) {
    // put everything back so the person can try again or confirm the whole receipt
    for (const t of created) {
      await updateTransaction(db, user.id, t.id, { status: "deleted" }).catch(() => undefined);
    }
    await releasePendingTransaction(db, user.id, tx.id).catch(() => undefined);
    throw error;
  }
}

/**
 * After an entry is confirmed: the day's point, and the one-time referral bonus on the first
 * activity of a referred user. Silent unless a bonus was just paid. Never throws.
 */
async function awardAndNotify(deps: HandlerDeps, userId: string): Promise<LineMessage[]> {
  const result = await awardActivity(deps.db, userId, deps.now());
  return result.referralBonus ? [text(REFERRAL_BONUS_TEXT)] : [];
}

async function pointsSummaryText(db: SupabaseClient, userId: string, now: Date): Promise<string> {
  const [row, keys] = await Promise.all([
    db.from("users").select("points").eq("id", userId).single(),
    recentDailyKeys(db, userId),
  ]);
  const points = (row.data as { points?: number } | null)?.points ?? 0;
  const streak = currentStreak(keys, now);
  const { days } = redeemable(points);
  return [
    `เหรียญสะสมของคุณ: ${points} แต้ม`,
    streak > 0 ? `จดต่อเนื่อง ${streak} วันแล้ว` : "วันนี้จดรายการแรกเพื่อเริ่มสะสมนะ",
    days > 0
      ? `แลกเป็นวันใช้ Pro ได้ ${days} วัน (แลกที่หน้าตั้งค่า)`
      : "สะสมครบแล้วแลกเป็นวันใช้ Pro ได้ที่หน้าตั้งค่านะ",
  ].join("\n");
}

/** The card theme and bot manner in force for a user (the defaults on a free or lapsed plan). Best effort. */
async function prefsOf(deps: HandlerDeps, user: UserRow) {
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
  const fallback = { theme: DEFAULT_THEME, persona: DEFAULT_PERSONA };
  if (!can(plan, "personalize")) return fallback;
  try {
    return effectivePrefs(plan, await getSettings(deps.db, user.id));
  } catch (error) {
    log.error("prefs_failed", error);
    return fallback;
  }
}

/** Budget alerts are best effort: a failure here must never block recording the entry. */
async function safeAlerts(
  deps: HandlerDeps,
  userId: string,
  tx: TxRow,
  categoryId: string | null,
): Promise<string[]> {
  try {
    return await budgetAlertsFor(deps.db, {
      userId,
      type: tx.type,
      categoryId,
      amountSatang: txAmountSatang(tx),
      occurredAt: new Date(tx.occurred_at),
      now: deps.now(),
    });
  } catch (error) {
    log.error("budget_alert_failed", error);
    return [];
  }
}

/** The daily-limit scold for what this message added to today (best effort, like the budget alerts). */
async function safeDailyAlerts(
  deps: HandlerDeps,
  userId: string,
  saved: { tx: TxRow }[],
): Promise<string[]> {
  const today = deps.now();
  const expenses = saved.filter((s) => s.tx.type === "expense");
  const todays = expenses.filter(
    (s) => bangkokDateKey(new Date(s.tx.occurred_at)) === bangkokDateKey(today),
  );
  const amountSatang = todays.reduce((sum, s) => sum + txAmountSatang(s.tx), 0);
  if (amountSatang <= 0) return [];
  try {
    return await dailyBudgetAlertsFor(deps.db, {
      userId,
      amountSatang,
      occurredAt: today,
      now: today,
    });
  } catch (error) {
    log.error("daily_budget_alert_failed", error);
    return [];
  }
}

/** The "จ่ายด้วย" pills: the chosen wallet first, then the others; with more than four, three and "อื่น ๆ". */
function walletPills(wallets: Wallet[], chosen: Wallet) {
  const shown = wallets.length <= 4 ? 4 : 3;
  const ordered = [chosen, ...wallets.filter((w) => w.id !== chosen.id)];
  return {
    choices: ordered.slice(0, shown).map((w) => ({
      id: w.id,
      label: walletLabel(w),
      selected: w.id === chosen.id,
    })),
    more: wallets.length > shown,
  };
}

/** What a caller adds to the entry card beyond the entry itself. */
interface CardExtras {
  /** Everything just added to the budget this entry counts against (several entries of one message). */
  batchSatang?: number;
  /** Put the budget warning on this card (false on the earlier cards of the same budget). */
  budgetNotice?: boolean;
  /** Other warnings to carry (daily limit, card limit). */
  notices?: { text: string; level: "warn" | "over" }[];
  /** Filled by confirmCard: whether the card shows any warning. */
  out?: { noticed: boolean };
}

async function confirmCard(
  tx: TxRow,
  categoryId: string | null,
  categories: CategoryLite[],
  settings: SettingsRow,
  user: UserRow,
  deps: HandlerDeps,
  tags: string[] = [],
  walletId: string | null = null,
  fxNote: string | null = null,
  edited = false,
  extras: CardExtras = {},
): Promise<LineMessage> {
  const style = settings.confirm_style === "short" ? "short" : "full";
  // The wallet only shows up once there is more than one to tell apart.
  const wallets = await listWallets(deps.db, user.id).catch(() => []);
  const multi = wallets.length > 1;
  const wallet = multi
    ? (wallets.find((w) => w.id === walletId) ?? wallets.find((w) => w.isDefault))
    : undefined;
  let cycleTotal: number | null = null;
  if (style === "full" && categoryId) {
    const range = cycleRange(deps.now(), settings.budget_cycle, settings.cycle_start_day);
    cycleTotal = await categoryTotalSatang(deps.db, {
      userId: user.id,
      categoryId,
      type: tx.type,
      from: range.from,
      to: range.to,
    });
  }
  // Where the budget stands, and the warnings the card itself carries (no separate messages).
  let budget: BudgetStatus | null = null;
  const notices: { text: string; level: "warn" | "over" }[] = [...(extras.notices ?? [])];
  if (style === "full" && tx.type === "expense") {
    try {
      const reading = await budgetReadingFor(deps.db, {
        userId: user.id,
        type: tx.type,
        categoryId,
        amountSatang: extras.batchSatang ?? txAmountSatang(tx),
        occurredAt: new Date(tx.occurred_at),
        now: deps.now(),
      });
      if (reading) {
        budget = reading.status;
        if (reading.notice && extras.budgetNotice !== false && !edited) {
          notices.unshift({
            text: reading.notice,
            level: reading.status.level === "over" ? "over" : "warn",
          });
        }
      }
    } catch (error) {
      log.error("budget_status_failed", error);
    }
  }
  if (extras.out) extras.out.noticed = notices.length > 0;
  // "จ่ายด้วย": the chosen wallet first, then the others; more than three become "อื่น ๆ"
  let walletChoices: { id: string; label: string; selected: boolean }[] | undefined;
  let moreWallets = false;
  const chosenWallet =
    wallets.find((w) => w.id === walletId) ?? wallets.find((w) => w.isDefault) ?? wallets[0];
  // choosing how it was paid is for Pro and above (the wallets and cards they set up)
  const canChoose = can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "multiAccount");
  if (style === "full" && canChoose && chosenWallet && !edited) {
    ({ choices: walletChoices, more: moreWallets } = walletPills(wallets, chosenWallet));
  }
  // "📎 แนบรูป" at the bottom-left of the card (Pro and above, unless the person turned it off):
  // only a tap on it makes the next image this entry's photo, so a bill sent next is just a bill.
  const photoButton =
    style === "full" &&
    !edited &&
    settings.photo_prompt !== false &&
    can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "entryPhoto");
  return buildConfirmMessage({
    style,
    photoButton,
    budget,
    notices,
    walletChoices,
    moreWallets,
    addWalletUrl: pageUrl("/wallets"),
    txId: tx.id,
    type: tx.type,
    title: tx.title,
    categoryName: categoryLabelOf(categories.find((c) => c.id === categoryId)),
    amountSatang: txAmountSatang(tx),
    occurredAt: new Date(tx.occurred_at),
    tags,
    walletName: wallet ? walletLabel(wallet) : null,
    canMoveWallet: multi,
    fxNote,
    editUrl: pageUrl(`/transactions?edit=${tx.id}`),
    edited,
    cycleTotalSatang: cycleTotal,
    cycleLabel:
      settings.budget_cycle === "weekly"
        ? "รายสัปดาห์"
        : `รายเดือน (วันที่ ${settings.cycle_start_day})`,
    logoUrl: process.env.APP_BASE_URL
      ? `${process.env.APP_BASE_URL.replace(/\/$/, "")}/success-logo.png?v=2`
      : undefined,
  });
}

/** The "แก้ไขรายการสำเร็จ" card of the entry the user edited in the last quarter of an hour (null if none). */
export async function editedCardFor(user: UserRow, deps: HandlerDeps): Promise<LineMessage | null> {
  const { db } = deps;
  const edited = await getRecentlyEdited(db, user.id, new Date(deps.now().getTime() - 15 * 60_000));
  if (!edited) return null;
  const [settings, categories] = await Promise.all([
    getSettings(db, user.id),
    loadCategories(db, user.id),
  ]);
  return confirmCard(
    edited,
    edited.category_id,
    categories,
    settings,
    user,
    deps,
    [],
    edited.account_id,
    null,
    true,
    { budgetNotice: false },
  );
}

// ───────────────────────── commands ─────────────────────────

async function runCommand(
  command: Command,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[]> {
  const { db } = deps;
  switch (command.kind) {
    case "help":
      return [buildHelpPrompt((await prefsOf(deps, user)).persona)];

    case "summary": {
      const now = deps.now();
      const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
      const liffUrl = base ? `${base}/summary` : undefined;
      if (command.scope === "today") {
        const range = dayRange(now);
        const data = summarize(
          await loadSummaryTransactions(db, user.id, range.from, range.to),
          range,
          range,
        );
        const subtitle = formatThaiDate(now);
        if (data.current.count === 0) return [text(`สรุปวันนี้ (${subtitle})\nยังไม่มีรายการเลย`)];
        // with a daily limit set (Pro and above) the card says how much of it is used
        const limit = await dailyLimitOf(user, deps);
        return [
          withSummaryShortcuts(
            buildSummaryCard({
              title: "สรุปวันนี้",
              range,
              data,
              subtitle,
              liffUrl,
              dailyLimitSatang: limit ?? undefined,
            }),
          ),
        ];
      }
      const settings = await getSettings(db, user.id);
      const range =
        settings.budget_cycle === "monthly"
          ? cycleRange(now, "monthly", settings.cycle_start_day)
          : calendarMonthRange(now);
      const previous = previousRange("monthly", range);
      const data = summarize(
        await loadSummaryTransactions(db, user.id, previous.from, range.to),
        range,
        previous,
      );
      const last = new Date(range.to.getTime() - 1);
      const subtitle = `${formatThaiDate(range.from)} – ${formatThaiDate(last)}`;
      if (data.current.count === 0) return [text(`สรุปเดือนนี้ (${subtitle})\nยังไม่มีรายการเลย`)];
      return [
        withSummaryShortcuts(
          buildSummaryCard({
            title: "สรุปเดือนนี้",
            range,
            data,
            against: "เดือนก่อน",
            subtitle,
            liffUrl,
          }),
        ),
      ];
    }

    case "summary-range-usage":
      return [text(SUMMARY_RANGE_USAGE_TEXT)];

    case "summary-menu":
      return [buildSummaryMenu(pageUrl("/summary"))];

    case "summary-range-pick": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "customRange")) {
        return [text(SUMMARY_RANGE_LOCKED_TEXT)];
      }
      return [buildRangeStartPicker(deps.now())];
    }

    case "summary-preset": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "customRange")) {
        return [text(SUMMARY_RANGE_LOCKED_TEXT)];
      }
      const { start, end } = presetRange(command.preset, deps.now());
      return summaryForRange(user, deps, start, end, PRESET_TITLE[command.preset]);
    }

    case "recent": {
      const items = await loadSearchItems(db, user.id, { q: null, tag: null }, 5);
      if (items.length === 0) return [text(RECENT_EMPTY_TEXT)];
      return [buildRecentCard({ items, moreUrl: listUrl("") })];
    }

    case "category-spend": {
      const now = deps.now();
      const settings = await getSettings(db, user.id);
      const range =
        settings.budget_cycle === "monthly"
          ? cycleRange(now, "monthly", settings.cycle_start_day)
          : calendarMonthRange(now);
      const subtitle = `${formatThaiDate(range.from)} – ${formatThaiDate(new Date(range.to.getTime() - 1))}`;
      const slices = buildCategorySlices(await loadCategorySpend(db, user.id, range));
      if (slices.length === 0)
        return [text(`ใช้จ่ายตามหมวด (${subtitle})\nยังไม่มีรายจ่ายในรอบนี้`)];
      const totalSatang = slices.reduce((sum, s) => sum + s.amountSatang, 0);
      return [
        buildCategorySpendCard({
          subtitle,
          slices,
          totalSatang,
          // the charts page is a Pro feature: Free is not sent to a locked page
          moreUrl: can(effectivePlan(user.plan, user.plan_expires_at, now), "dashboard")
            ? pageUrl("/analytics")
            : undefined,
        }),
      ];
    }

    case "compare-months": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "categoryCompare")) {
        return [text(COMPARE_LOCKED_TEXT)];
      }
      const now = deps.now();
      const settings = await getSettings(db, user.id);
      const cycle =
        settings.budget_cycle === "monthly"
          ? cycleRange(now, "monthly", settings.cycle_start_day)
          : calendarMonthRange(now);
      const span = sameSpanRanges(cycle, now);
      const result = await loadCategoryCompare(db, user.id, span.current, span.previous);
      if (result.currentSatang === 0 && result.previousSatang === 0) {
        return [text(COMPARE_EMPTY_TEXT)];
      }
      return [
        buildCompareCard({
          currentLabel: rangeLabel(span.current),
          previousLabel: rangeLabel(span.previous),
          rows: result.rows,
          currentSatang: result.currentSatang,
          previousSatang: result.previousSatang,
          totalChange: describeTotals(result.currentSatang, result.previousSatang),
          moreUrl: pageUrl("/analytics"),
        }),
      ];
    }

    case "forecast": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "forecast")) {
        return [text(FORECAST_LOCKED_TEXT)];
      }
      const now = deps.now();
      const settings = await getSettings(db, user.id);
      const cycle =
        settings.budget_cycle === "monthly"
          ? cycleRange(now, "monthly", settings.cycle_start_day)
          : calendarMonthRange(now);
      const forecastInput = await loadForecastInput(db, user.id, now, cycle);
      if (forecastInput.entryCount === 0 && forecastInput.upcoming.length === 0) {
        return [text(FORECAST_EMPTY_TEXT)];
      }
      const today = bangkokParts(now);
      return [
        buildForecastCard({
          forecast: forecastCycle(forecastInput),
          today: fromBangkok(today.year, today.month, today.day),
          subtitle: `${formatThaiDate(cycle.from)} – ${formatThaiDate(new Date(cycle.to.getTime() - 1))}`,
          moreUrl: pageUrl("/summary"),
        }),
      ];
    }

    case "bills": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "billReminder")) {
        return [text(BILL_LOCKED_TEXT)];
      }
      const today = billTodayKey(deps.now());
      const wallets = await listWallets(db, user.id).catch(() => []);
      const all = [...(await listBills(db, user.id)), ...cardBills(wallets, today)].sort((a, b) =>
        a.nextDueOn.localeCompare(b.nextDueOn),
      );
      if (all.length === 0) return [text(BILL_EMPTY_TEXT)];
      return [buildBillsCard({ bills: all, today, manageUrl: pageUrl("/bills") })];
    }

    case "wallet-join":
    case "wallet-invite":
    case "wallet-leave": // handled in handleText; only reached by a direct call
      return [text(SHARED_JOIN_USAGE_TEXT)];

    case "bill-new-usage":
      return [text(BILL_USAGE_TEXT)];

    case "bill-new":
    case "bill-pay": // handled in handleText; only reached by a direct call
      return [text(BILL_USAGE_TEXT)];

    case "goals": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "savingsGoal")) {
        return [text(GOAL_LOCKED_TEXT)];
      }
      const goals = (await listGoals(db, user.id, deps.now())).filter((g) => !g.archived);
      if (goals.length === 0) return [text(GOAL_EMPTY_TEXT)];
      return [buildGoalsCard({ goals, manageUrl: pageUrl("/goals") })];
    }

    case "goal-new":
    case "goal-deposit":
    case "goal-withdraw": // handled in handleText; only reached by a direct call
      return [text(GOAL_EMPTY_TEXT)];

    case "daily-budget": {
      const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
      if (command.action === "usage") return [text(DAILY_BUDGET_USAGE_TEXT)];
      if (command.action === "clear") {
        await saveDailyBudget(deps, user.id, null);
        return [text(DAILY_BUDGET_CLEARED_TEXT)];
      }
      if (!can(plan, "dailyBudget")) return [text(DAILY_BUDGET_LOCKED_TEXT)];
      if (command.action === "set" && command.amountSatang) {
        await saveDailyBudget(deps, user.id, command.amountSatang);
        return [text(dailyBudgetSetText(formatBaht(command.amountSatang)))];
      }
      const limit = await dailyLimitOf(user, deps);
      if (limit === null) return [text(DAILY_BUDGET_NONE_TEXT)];
      const range = dayRange(deps.now());
      const spent = await expenseTotalSatang(db, {
        userId: user.id,
        from: range.from,
        to: range.to,
      });
      return [text(dailyBudgetStatus(spent, limit))];
    }

    case "debts": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "debts")) {
        return [text(DEBT_LOCKED_TEXT)];
      }
      const people = totalsByPerson(await listDebts(db, user.id));
      if (people.length === 0) return [text(DEBT_EMPTY_TEXT)];
      return [buildDebtsCard({ people, now: deps.now(), manageUrl: pageUrl("/debts") })];
    }

    case "debt-new":
    case "debt-pay": // handled in handleText; only reached by a direct call
      return [text(DEBT_EMPTY_TEXT)];

    case "cards": // handled in handleText; only reached by a direct call
      return [text(CARD_NONE_TEXT)];

    case "transfer": // handled in handleText; only reached by a direct call
      return [text(TRANSFER_USAGE_TEXT)];

    case "wallets": {
      const wallets = await ensureWallets(db, user.id);
      const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
      return [
        buildWalletsCard({
          wallets,
          canAdd: wallets.length < walletCapacity(plan),
          manageUrl: pageUrl("/wallets"),
        }),
      ];
    }

    case "insight": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "insight")) {
        return [text(INSIGHT_LOCKED_TEXT)];
      }
      if (deps.limit) {
        const day = await deps.limit("insight_day", user.line_user_id, LIMITS.insightDay);
        if (!day.allowed) return [text(INSIGHT_LIMIT_TEXT)];
      }
      const now = deps.now();
      const settings = await getSettings(db, user.id);
      const cycle =
        settings.budget_cycle === "monthly"
          ? cycleRange(now, "monthly", settings.cycle_start_day)
          : calendarMonthRange(now);
      const span = sameSpanRanges(cycle, now);
      const facts = await loadInsightFacts(db, user.id, span.current, span.previous, {
        current: rangeLabel(span.current),
        previous: "เดือนก่อน",
      });
      if (!hasSomethingToSay(facts)) return [text(INSIGHT_EMPTY_TEXT)];
      const insight = await generateInsight(deps.insightWriter, facts);
      return [
        buildInsightCard({
          insight,
          subtitle: `รอบนี้ ${rangeLabel(span.current)} เทียบ ${rangeLabel(span.previous)}`,
          moreUrl: can(effectivePlan(user.plan, user.plan_expires_at, now), "dashboard")
            ? pageUrl("/analytics")
            : undefined,
        }),
      ];
    }

    case "year-summary": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "yearSummary")) {
        return [text(YEAR_LOCKED_TEXT)];
      }
      const year = resolveYear(command.year, deps.now());
      if (!year.ok) return [text(YEAR_BAD_TEXT)];
      const data = await loadYearData(db, user.id, year);
      const yearBE = year.year + 543;
      if (data.summary.current.count === 0) return [text(yearEmptyText(yearBE))];
      return [
        buildYearCard({
          yearBE,
          subtitle: `${formatThaiDate(year.range.from)} – ${formatThaiDate(new Date(year.range.to.getTime() - 1))}`,
          income: data.summary.current.income,
          expense: data.summary.current.expense,
          changePercent: expenseChangePercent(data.summary),
          topExpenses: data.summary.topExpenses,
          months: data.months.map((m) => ({ month: m.month, expenseSatang: m.expenseSatang })),
          moreUrl: pageUrl("/analytics"),
        }),
      ];
    }

    case "search-usage":
      return [text(SEARCH_USAGE_TEXT)];

    case "kept-search": {
      const files = fileChatDeps(deps);
      if (!files) return runCommand({ kind: "note-search", term: command.term }, user, deps);
      return runFileSearch(files, user, command.term, true);
    }

    case "file-save":
    case "file-rename":
    case "file-search":
    case "file-list": {
      const files = fileChatDeps(deps);
      if (!files) return [text(FILE_UNAVAILABLE_TEXT)];
      if (command.kind === "file-save") return runFileSave(files, user, command.name);
      if (command.kind === "file-rename") return runFileRename(files, user, command.name);
      if (command.kind === "file-search") return runFileSearch(files, user, command.term, false);
      return runFileList(files, user);
    }

    case "note-add": {
      const body = cleanNoteBody(command.body);
      if (!body) return [text(NOTE_EMPTY_TEXT)];
      if (body.length > MAX_NOTE_LENGTH) return [text(NOTE_TOO_LONG_TEXT(MAX_NOTE_LENGTH))];
      const limit = noteCapacity(effectivePlan(user.plan, user.plan_expires_at, deps.now()));
      if ((await countNotes(db, user.id)) >= limit) return [text(NOTE_FULL_TEXT(limit))];
      const note = await createNote(db, user.id, body);
      const saved = NOTE_SAVED_TEXT(noteTitle(body, 60), pageUrl("/notes"));
      return [
        {
          ...text(looksSecret(body) ? `${saved}\n\n${NOTE_SECRET_WARNING_TEXT}` : saved),
          quickReply: {
            items: [
              {
                type: "action",
                action: {
                  type: "postback",
                  label: "↩️ ยกเลิกโน้ตนี้",
                  data: `a=ntx&id=${note.id}`,
                  displayText: "ยกเลิกโน้ตนี้",
                },
              },
            ],
          },
        },
      ];
    }

    case "open-page": {
      const url = pageUrl(`/${command.page}`);
      return [
        url
          ? buildOpenPageCard(command.page, url)
          : text(`เปิดหน้า${PAGE_INFO[command.page].title} ได้จากเมนูด้านล่างของแอป`),
      ];
    }

    case "owl-start":
      return owlStart(owlDeps(deps), user);

    case "owl-end":
      return owlEnd(owlDeps(deps), user);

    case "owl-ask":
      return owlAsk(owlDeps(deps), user, command.question, false, user.line_user_id);

    case "remind-list": {
      const items = await listReminders(db, user.id, 5);
      if (items.length === 0) return [text(REMINDER_EMPTY_TEXT)];
      const lines = items.map(
        (r) => `• ${describeReminder(new Date(r.remindAt), r.repeat)}  ${r.body}`,
      );
      const url = pageUrl("/reminders");
      return [
        text(
          ["เตือนที่รออยู่ ⏰", ...lines, ...(url ? [`ดู แก้ไข หรือลบ: ${url}`] : [])].join("\n"),
        ),
      ];
    }

    case "remind-add": {
      const parsed = parseReminder(command.text, deps.now());
      if (!parsed.ok) {
        return [
          text(
            parsed.reason === "no_text"
              ? REMINDER_NO_TEXT_TEXT
              : parsed.reason === "past"
                ? REMINDER_PAST_TEXT
                : parsed.reason === "too_far"
                  ? REMINDER_TOO_FAR_TEXT
                  : REMINDER_USAGE_TEXT,
          ),
        ];
      }
      const limit = reminderCapacity(effectivePlan(user.plan, user.plan_expires_at, deps.now()));
      if ((await countActiveReminders(db, user.id)) >= limit) {
        return [text(REMINDER_FULL_TEXT(limit))];
      }
      const made = await createReminder(db, user.id, {
        body: parsed.body,
        remindAt: parsed.remindAt,
        repeat: parsed.repeat,
      });
      return [
        buildReminderCard({
          id: made.id,
          body: made.body,
          remindAt: parsed.remindAt,
          repeat: parsed.repeat,
          timeDefaulted: parsed.timeDefaulted,
          rolledToTomorrow: parsed.rolledToTomorrow,
          listUrl: pageUrl("/reminders"),
        }),
      ];
    }

    case "note-list": {
      const { items } = await listNotes(db, user.id, { limit: 5 });
      if (items.length === 0) return [text(NOTE_EMPTY_TEXT)];
      return [text(noteListText("โน้ตล่าสุด", items, pageUrl("/notes")))];
    }

    case "note-search": {
      if (!command.term) return [text(NOTE_SEARCH_USAGE_TEXT)];
      const { items, hasMore } = await listNotes(db, user.id, { q: command.term, limit: 5 });
      if (items.length === 0) return [text(noteNotFoundText(command.term))];
      const url = pageUrl(`/notes?q=${encodeURIComponent(command.term)}`);
      return [text(noteListText(`โน้ตที่มี "${command.term}"`, items, url, hasMore))];
    }

    case "search": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "searchTotals")) {
        return [text(SEARCH_LOCKED_TEXT)];
      }
      const target = parseSearchTerm(command.term);
      if (!target) return [text(SEARCH_USAGE_TEXT)];
      const term = target.tag ? `#${target.tag}` : (target.q ?? "");
      const [totals, items] = await Promise.all([
        loadSearchTotals(db, user.id, target),
        loadSearchItems(db, user.id, target, 5),
      ]);
      if (totals.count === 0) return [text(searchEmptyText(term))];
      return [buildSearchCard({ term, totals, items, moreUrl: listUrl(term) })];
    }

    case "summary-range": {
      if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "customRange")) {
        return [text(SUMMARY_RANGE_LOCKED_TEXT)];
      }
      return summaryForRange(
        user,
        deps,
        command.start,
        command.end === "today" ? null : command.end,
      );
    }

    case "delete-latest": {
      const latest = await getLatestConfirmed(db, user.id);
      if (!latest) return [text(NOTHING_TO_DELETE_TEXT)];
      await updateTransaction(db, user.id, latest.id, { status: "deleted" });
      return [text(`ลบแล้ว: ${latest.title} ฿${formatBaht(txAmountSatang(latest))}`)];
    }

    case "edit-latest": {
      const latest = await getLatestConfirmed(db, user.id);
      if (!latest) return [text(NOTHING_TO_DELETE_TEXT)];
      await updateTransaction(db, user.id, latest.id, { amountSatang: command.amountSatang });
      return [
        text(
          `แก้แล้ว: ${latest.title} ฿${formatBaht(txAmountSatang(latest))} → ฿${formatBaht(command.amountSatang)}`,
        ),
      ];
    }

    case "edit-done": {
      // the LIFF editor sends this after a save: show what was just edited (nothing if nothing was)
      const card = await editedCardFor(user, deps);
      return card ? [card] : [];
    }

    case "edit-latest-usage":
      return [text(EDIT_USAGE_TEXT)];

    case "payment-show":
    case "payment-usage":
    case "payment-promptpay":
    case "payment-bank":
    case "payment-clear":
      return runPaymentCommand(command, user, deps);

    case "points":
      return [text(await pointsSummaryText(db, user.id, deps.now()))];

    case "my-code": {
      const { data } = await db.from("users").select("referral_code").eq("id", user.id).single();
      const code = (data as { referral_code?: string } | null)?.referral_code;
      return [text(code ? referralShareText(code) : ERROR_TEXT)];
    }

    case "use-code-usage":
      return [text(USE_CODE_USAGE_TEXT)];

    case "use-code": {
      const outcome = await applyReferralCode(db, user.id, command.code);
      return [text(outcome === "ok" ? REFERRAL_OK_TEXT : REFERRAL_FAIL_TEXT[outcome])];
    }
  }
}

// ───────────────────────── postbacks ─────────────────────────

async function handlePostback(
  data: string,
  user: UserRow,
  deps: HandlerDeps,
  pickerParams?: { date?: string; time?: string; datetime?: string },
): Promise<LineMessage[]> {
  const params = new URLSearchParams(data);
  const action = params.get("a");
  // Rich Menu "พี่ฮูก": answer with the how-to card; its button opens the keyboard (a=compose-go).
  if (action === "compose") return [buildComposeCard()];
  // "จบการถาม" under an answer of พี่ฮูก.
  if (action === "owlx") return owlEnd(owlDeps(deps), user);
  // "ยกเลิกเตือนนี้" on the card of a reminder that was just set.
  if (action === "rmx") {
    const id = params.get("id") ?? "";
    if (!UUID_RE.test(id)) return [text(NOT_FOUND_TEXT)];
    return [
      text(
        (await cancelReminder(deps.db, user.id, id)) ? REMINDER_CANCELLED_TEXT : REMINDER_GONE_TEXT,
      ),
    ];
  }
  // The buttons under a file that was sent: keep it, or read a PDF for its entries.
  if (action === "fsv" || action === "frd") {
    const id = params.get("id") ?? "";
    const files = fileChatDeps(deps);
    if (!files || !UUID_RE.test(id)) return [text(FILE_EXPIRED_TEXT)];
    return handleFilePick(files, user, action, id, async (media) => {
      // a reading is a paid AI call, so this is where the limit on them belongs
      const limit = await deps.limit?.("chat_pdf", user.line_user_id, LIMITS.chatPdf);
      if (limit && !limit.allowed) return [text(TOO_MANY_MESSAGES_TEXT)];
      return readPdf(
        {
          id: media.messageId,
          fileName: media.fileName ?? undefined,
          fileSize: media.fileSize ?? undefined,
        },
        user,
        deps,
        user.line_user_id,
      );
    });
  }
  // The buttons under a message the AI was not sure about.
  if (action === "irp") {
    const id = params.get("id") ?? "";
    if (!UUID_RE.test(id)) return [text(NOT_FOUND_TEXT)];
    const chatting = await inOwlMode(owlDeps(deps), user);
    const picks = intentDeps(user, deps, chatting);
    const replies = await handleIntentPick(id, params.get("p") ?? "", user, picks, chatting);
    return chatting ? keepOwlOpen(owlDeps(deps), user, replies) : replies;
  }
  // "ยกเลิกโน้ตนี้" under a note that was just saved.
  if (action === "ntx") {
    const id = params.get("id") ?? "";
    if (!UUID_RE.test(id)) return [text(NOT_FOUND_TEXT)];
    return [text((await deleteNote(deps.db, user.id, id)) ? NOTE_UNDONE_TEXT : NOT_FOUND_TEXT)];
  }
  // The card of a recorded slip / receipt: ❌ on a row deletes that entry, "ยกเลิกทั้งใบ" all of them.
  if (action === "rdx") {
    const id = params.get("id") ?? "";
    if (!UUID_RE.test(id)) return [text(NOT_FOUND_TEXT)];
    const tx = await getTransaction(deps.db, user.id, id);
    if (!tx || tx.status !== "confirmed" || !tx.slip_id) return [text(NOT_FOUND_TEXT)];
    await updateTransaction(deps.db, user.id, id, { status: "deleted" });
    return [text(`ลบแล้ว: ${tx.title} ฿${formatBaht(txAmountSatang(tx))}`)];
  }
  // The "จ่ายด้วย" row of that card moves the whole slip to a wallet or card.
  if (action === "wls" || action === "wms") {
    const slipId = params.get("s") ?? "";
    if (!UUID_RE.test(slipId)) return [text(NOT_FOUND_TEXT)];
    const wallets = await listWallets(deps.db, user.id);
    if (action === "wls") {
      if (wallets.length < 2) return [];
      return [
        buildWalletChooser({
          txId: "",
          slipId,
          wallets,
          currentId: null,
          text: WALLET_SLIP_ASK_TEXT,
        }),
      ];
    }
    const target = wallets.find((w) => w.id === params.get("w"));
    if (!target) return [text(NOT_FOUND_TEXT)];
    const moved = await setSlipWallet(
      deps.db,
      user.id,
      slipId,
      target.isDefault ? null : target.id,
    );
    return [text(moved > 0 ? WALLET_SLIP_MOVED_TEXT(walletLabel(target), moved) : NOT_FOUND_TEXT)];
  }
  if (action === "rcx") {
    const slipId = params.get("s") ?? "";
    if (!UUID_RE.test(slipId)) return [text(NOT_FOUND_TEXT)];
    const dropped = await cancelSlipEntries(deps.db, user.id, slipId);
    return [text(dropped > 0 ? `ยกเลิกทั้งใบแล้ว ลบ ${dropped} รายการ` : NOT_FOUND_TEXT)];
  }
  // The check card of a PDF: record or drop every entry of that file at once.
  if (action === "pdfok" || action === "pdfx") {
    const importId = params.get("i") ?? "";
    if (!UUID_RE.test(importId)) return [text(NOT_FOUND_TEXT)];
    if (action === "pdfx") {
      const dropped = await cancelImport(deps.db, user.id, importId);
      return [text(dropped > 0 ? PDF_CANCELLED_TEXT : PDF_ALREADY_DONE_TEXT)];
    }
    const recorded = await confirmImport(deps.db, user.id, importId);
    if (recorded === 0) return [text(PDF_ALREADY_DONE_TEXT)];
    return [text(pdfRecordedText(recorded)), ...(await awardAndNotify(deps, user.id))];
  }
  // A topic chip under the help question: that topic's card (it carries the chips along, so they stay).
  if (action === "help") {
    const topic = params.get("t");
    if (!isHelpTopic(topic)) return [buildHelpPrompt((await prefsOf(deps, user)).persona)];
    return [
      buildHelpTopicCard({
        topic,
        plan: effectivePlan(user.plan, user.plan_expires_at, deps.now()),
        appUrl: appBaseUrl(),
      }),
    ];
  }
  // "ทดลองใช้ฟรี 7 วัน" on an upgrade card: the same trial as on the web, started in the chat.
  if (action === "trial") {
    return startTrialFromChat(deps.db, user.id, deps.now(), formatThaiDate);
  }
  // "จดเป็นวันนี้แทน" on the backdate card: the same text again, with every entry dated today.
  if (action === "bdt") {
    const original = params.get("t") ?? "";
    const redo = parseMessage(original, deps.now()).entries.map((e) => ({
      ...e,
      occurredAt: deps.now(),
      backdated: false,
    }));
    if (redo.length === 0) return [notUnderstood()];
    const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
    // Only the date is changed; anything else Free cannot do (several entries, tags) still applies.
    if (redo.length > 1 && !can(plan, "multiEntry")) return [text(MULTI_ENTRY_LOCKED_TEXT)];
    if (redo.some((e) => e.tags.length > 0) && !can(plan, "tags")) return [text(TAGS_LOCKED_TEXT)];
    return saveEntries(redo, user, deps, new Map());
  }
  // "📆 ช่วงวันเอง" under a summary card: pick the first day, then the last (Pro and above).
  // The first day travels in the button's data, so nothing is stored between the two taps.
  if (action === "sr" || action === "sr1" || action === "sr2") {
    if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "customRange")) {
      return [text(SUMMARY_RANGE_LOCKED_TEXT)];
    }
    if (action === "sr") return [buildRangeStartPicker(deps.now())];
    const picked = daySpecFromIso(pickerParams?.date);
    if (action === "sr1") {
      if (!picked) return [text(SUMMARY_RANGE_BAD_DATE_TEXT)];
      const at = fromBangkok(picked.year!, picked.month, picked.day);
      const iso = pickerParams!.date!;
      return [buildRangeEndPicker(iso, formatThaiDate(at), deps.now())];
    }
    const first = daySpecFromIso(params.get("f") ?? undefined);
    if (!first || !picked) return [text(SUMMARY_RANGE_BAD_DATE_TEXT)];
    return summaryForRange(user, deps, first, picked);
  }
  // "📅 จดย้อนหลัง" under that card: Pro and above get the calendar, others the upsell
  // (checked here, before the calendar opens). a=bdk (the keyboard button) is silent.
  if (action === "bd") {
    if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "backdate")) {
      return [text(BACKDATE_PICKER_LOCKED_TEXT)];
    }
    return [buildDatePicker(deps.now())];
  }
  // The day chosen on the calendar -> open the keyboard with "DD/MM/YYYY " already typed.
  if (action === "bdp") {
    if (!can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "backdate")) {
      return [text(BACKDATE_PICKER_LOCKED_TEXT)];
    }
    const picked = backdateFromPicker(pickerParams?.date, deps.now());
    if (!picked) return [text(BACKDATE_BAD_DATE_TEXT)];
    return [buildBackdatePrompt(picked.iso, picked.thai)];
  }
  // Quick Reply under that card: the categories of the chosen type (a=cc taps are silent).
  if (action === "cp") {
    const type = params.get("t") === "income" ? "income" : "expense";
    return [buildCategoryKeyboardList(type, await loadCategories(deps.db, user.id))];
  }

  // "↩ ยกเลิกการโอน" under a transfer: the id is a transfer, not an entry
  if (action === "tc") {
    const transferId = params.get("id");
    if (!transferId) return [];
    const removed = await deleteTransfer(deps.db, user.id, transferId);
    return [text(removed ? TRANSFER_CANCELLED_TEXT : NOT_FOUND_TEXT)];
  }

  // The buttons under a bill reminder (a=bp paid, a=bk skip, a=bz remind tomorrow, a=be record it)
  if (action === "bp" || action === "bk" || action === "bz" || action === "be") {
    const billId = params.get("id") ?? "";
    const dueOn = params.get("d") ?? "";
    const bill = await getBill(deps.db, user.id, billId);
    if (!bill) return [text(BILL_GONE_TEXT)];

    if (action === "be") {
      if (!bill.amountSatang) return [text(BILL_GONE_TEXT)];
      // once per paid round: a second tap must not record it twice
      if (!(await claimReminder(deps.db, user.id, `${bill.id}:rec:${dueOn}`))) {
        return [text(BILL_RECORDED_ALREADY_TEXT)];
      }
      const { tx, categoryId } = await recordBillExpense(
        deps.db,
        user,
        bill,
        bill.amountSatang,
        deps.now(),
      );
      const [settings, categories] = await Promise.all([
        getSettings(deps.db, user.id),
        loadCategories(deps.db, user.id),
      ]);
      return [await confirmCard(tx, categoryId, categories, settings, user, deps)];
    }

    if (!bill.isActive) return [text(BILL_GONE_TEXT)];
    if (action === "bz") {
      await updateBill(deps.db, user.id, bill.id, {
        snoozedOn: addBillDays(billTodayKey(deps.now()), 1),
      });
      return [text(BILL_SNOOZED_TEXT)];
    }
    // a stale button (this round was already settled) must not skip the next round too
    if (bill.nextDueOn !== dueOn) return [text(BILL_GONE_TEXT)];
    return billPaid(bill, user, deps, action === "bp");
  }

  // "↩ ยกเลิก" under a deposit into a goal: the id is a deposit, g is its goal
  if (action === "gx") {
    const result = await undoDeposit(
      deps.db,
      user.id,
      params.get("g") ?? "",
      params.get("id") ?? "",
    );
    return [
      text(
        result === "ok"
          ? GOAL_UNDONE_TEXT
          : result === "blocked"
            ? GOAL_UNDO_BLOCKED_TEXT
            : NOT_FOUND_TEXT,
      ),
    ];
  }

  // "↩ ยกเลิก" under a debt or a repayment
  if (action === "dx" || action === "dpx") {
    const target = params.get("id") ?? "";
    const removed =
      action === "dx"
        ? await deleteDebt(deps.db, user.id, target)
        : (await deletePayments(deps.db, user.id, target.split(",").filter(Boolean))) > 0;
    return [text(removed ? DEBT_CANCELLED_TEXT : NOT_FOUND_TEXT)];
  }

  const id = params.get("id");
  if (!action || !id) return [];

  const { db } = deps;
  const tx = await getTransaction(db, user.id, id);
  if (!tx || tx.status === "deleted") return [text(NOT_FOUND_TEXT)];

  if (action === "del") {
    await updateTransaction(db, user.id, id, { status: "deleted" });
    return [text(`ลบแล้ว: ${tx.title} ฿${formatBaht(txAmountSatang(tx))}`)];
  }

  if (action === "edit") {
    // buttons on cards sent before the editor page existed: point to it
    const url = pageUrl(`/transactions?edit=${id}`);
    return [text(url ? `${EDIT_LINK_TEXT}\n${url}` : EDIT_HINT_TEXT)];
  }

  // "💳 ย้ายกระเป๋า": list the wallets, then (a=wm) move the entry to the one tapped
  if (action === "wl") {
    const wallets = await listWallets(db, user.id);
    if (wallets.length < 2) return [];
    return [buildWalletChooser({ txId: id, wallets, currentId: null, text: WALLET_MOVE_ASK_TEXT })];
  }
  if (action === "wm") {
    const target = (await listWallets(db, user.id)).find((w) => w.id === params.get("w"));
    if (!target) return [text(NOT_FOUND_TEXT)];
    const moved = await setEntryWallet(db, user.id, id, target.isDefault ? null : target.id);
    return [text(moved ? WALLET_MOVED_TEXT(tx.title, walletLabel(target)) : NOT_FOUND_TEXT)];
  }

  // "📷 แนบรูป" on an entry card: plan and cap first, then wait for the next image
  if (action === "ph") {
    const blocked = await photoBlockedReply(db, user.id, deps.now());
    if (blocked) return blocked;
    const current = await getPhotoTx(db, user.id, id);
    await startPhotoWait(db, user.id, id, deps.now());
    return [buildPhotoAsk(current?.photo_path ? PHOTO_ASK_REPLACE_TEXT : PHOTO_ASK_TEXT)];
  }

  // "แยก n รายการ" on a receipt card (Elite): one entry per product line
  if (action === "sp") return splitReceipt(tx, user, deps);

  if (action === "pt") {
    if (tx.status !== "pending_confirm") return [text(NOT_FOUND_TEXT)];
    const choice = params.get("t");
    if (choice === "cancel") {
      await updateTransaction(db, user.id, id, { status: "deleted" });
      return [text("ยกเลิกแล้ว ไม่ได้จดรายการนี้")];
    }
    if (choice !== "income" && choice !== "expense") return [];

    const type: TxType = choice;
    const [settings, categories, memory] = await Promise.all([
      getSettings(db, user.id),
      loadCategories(db, user.id),
      loadMemoryFor(db, user, deps.now()),
    ]);
    const { categoryId } = categorizeByRules({ title: tx.title, type, categories, memory });
    const updated = await updateTransaction(db, user.id, id, {
      type,
      categoryId,
      status: "confirmed",
    });
    if (!updated) return [text(NOT_FOUND_TEXT)];
    const bonus = await awardAndNotify(deps, user.id);
    // the full card carries the budget warning itself; other styles get it as a message
    const embed = settings.confirm_style === "full";
    const alerts = embed
      ? []
      : (await safeAlerts(deps, user.id, updated, categoryId)).map((a) => text(a));
    if (settings.confirm_style === "off") return [text("จดแล้ว"), ...alerts, ...bonus];
    return [
      await confirmCard(updated, categoryId, categories, settings, user, deps),
      ...alerts,
      ...bonus,
    ];
  }

  // ── slip review: confirm / pick category / cancel ──
  // (voice entries reuse the same steps; only "cancel" has its own wording)
  if (
    action === "sc" ||
    action === "se" ||
    action === "sk" ||
    action === "sx" ||
    action === "vx" ||
    action === "ax"
  ) {
    if (tx.status !== "pending_confirm") return [text(NOT_FOUND_TEXT)];

    if (action === "sx" || action === "vx" || action === "ax") {
      await updateTransaction(db, user.id, id, { status: "deleted" });
      return [
        text(
          action === "vx"
            ? VOICE_CANCELLED_TEXT
            : action === "ax"
              ? SMART_CANCELLED_TEXT
              : SLIP_CANCELLED_TEXT,
        ),
      ];
    }

    const [settings, categories, memory] = await Promise.all([
      getSettings(db, user.id),
      loadCategories(db, user.id),
      loadMemoryFor(db, user, deps.now()),
    ]);

    if (action === "se") {
      const choices = categories
        .filter((c) => c.type === tx.type && !c.is_hidden)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
      return [buildCategoryChooser(id, choices)];
    }

    let categoryId = tx.category_id;
    let learned: string | null = null;
    if (action === "sk") {
      const picked = categories.find((c) => c.id === params.get("c") && c.type === tx.type);
      if (!picked) return [text(NOT_FOUND_TEXT)];
      categoryId = picked.id;
      const slip = tx.slip_id ? await getSlip(db, user.id, tx.slip_id) : null;
      if (slip?.payee) {
        const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
        if (can(plan, "merchantMemory")) {
          await learnMerchant(db, { userId: user.id, payee: slip.payee, categoryId: picked.id });
          learned = `จำไว้แล้ว: ${slip.payee} → ${picked.name}`;
        } else {
          learned = MEMORY_PLUS_HINT_TEXT;
        }
      }
    } else if (categoryId === null) {
      // the guess found nothing: fall back to the rules once more
      categoryId = categorizeByRules({
        title: tx.title,
        type: tx.type,
        categories,
        memory,
      }).categoryId;
    }

    const updated = await updateTransaction(db, user.id, id, { categoryId, status: "confirmed" });
    if (!updated) return [text(NOT_FOUND_TEXT)];

    const out: LineMessage[] = [];
    if (settings.confirm_style === "off") out.push(text("จดแล้ว"));
    else out.push(await confirmCard(updated, categoryId, categories, settings, user, deps));
    if (learned) out.push(text(learned));
    // the full card carries the budget warning itself; other styles get it as a message
    if (settings.confirm_style !== "full") {
      for (const a of await safeAlerts(deps, user.id, updated, categoryId)) out.push(text(a));
    }
    out.push(...(await awardAndNotify(deps, user.id)));
    return out;
  }

  return [];
}
