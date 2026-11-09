/** Visual rig dimensions; movement/collision coordinates stay server-owned. */
export const AVATAR_BODY_SCALE_Y = .8;
export const AVATAR_HEAD_SCALE = 1.18;
export const AVATAR_HEAD_CENTER_Y = 1.24;
export const AVATAR_TORSO_Y = .64 * AVATAR_BODY_SCALE_Y;
export const AVATAR_HIP_Y = .62 * AVATAR_BODY_SCALE_Y;
export const AVATAR_SHOULDER_Y = .99 * AVATAR_BODY_SCALE_Y;
export const AVATAR_KNEE_OFFSET_Y = -.25 * AVATAR_BODY_SCALE_Y;
export const AVATAR_HAND_LOCAL_Y = -.196 * AVATAR_BODY_SCALE_Y;
export const AVATAR_FOOT_LOCAL_Y = -.25 * AVATAR_BODY_SCALE_Y;
// Existing chair seats hold the hips at .72, despite the shorter body.
export const AVATAR_SEATED_Y = .72 - AVATAR_HIP_Y;
