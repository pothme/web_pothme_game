export const COMMUNITY_RULES = [
  '서로 존중해 주세요. 욕설·혐오·괴롭힘·사칭은 금지합니다.',
  '도배·광고·리딩방 모집·사기성 홍보를 올리지 마세요.',
  '다른 사람의 개인정보와 불법 자료를 공개하지 마세요.',
  '투자 수익을 보장하거나 확인하지 않은 내용을 사실처럼 퍼뜨리지 마세요.',
  '게시글은 개인의 의견입니다. 문제 있는 글·댓글은 신고할 수 있고 관리자가 숨길 수 있습니다.',
] as const;
export const COMMUNITY_LIMITS = Object.freeze({ title: 60, post: 2000, comment: 300, nickname: 12, pageSize: 20, commentPageSize: 50, popularWindowDays: 7 });
export interface CommunityPostSummary { id: string; title: string; excerpt: string; nickname: string; createdAt: number; likeCount: number; commentCount: number; isMine: boolean; liked: boolean }
export interface CommunityPost extends CommunityPostSummary { body: string }
export interface CommunityComment { id: string; body: string; nickname: string; createdAt: number; isMine: boolean }
export interface CommunityList { ok: true; posts: CommunityPostSummary[]; page: number; hasMore: boolean; popularWindowDays: number; serverTime: number }
export interface CommunityTop { ok: true; posts: CommunityPost[]; popularWindowDays: number; serverTime: number }
export interface CommunityDetail { ok: true; post: CommunityPost; comments: CommunityComment[]; commentPage: number; hasMoreComments: boolean; serverTime: number }
export interface CommunityAdminPost { id: string; title: string; nickname: string; createdAt: number; likeCount: number; commentCount: number; hidden: boolean; deleted: boolean }
export interface CommunityAdminReport { id: string; targetType: 'post' | 'comment'; targetId: string; postId: string; title: string; nickname: string; text: string; reason: string; createdAt: number; hidden: boolean; deleted: boolean }
export interface CommunityAdminHiddenComment { id: string; postId: string; title: string; nickname: string; body: string; createdAt: number; postHidden: boolean }
export interface CommunityAdminState { ok: true; posts: CommunityAdminPost[]; reports: CommunityAdminReport[]; hiddenComments: CommunityAdminHiddenComment[]; page: number; hasMore: boolean; pendingReports: number }
