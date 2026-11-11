// 同一登录态下，续采和翻页不再查账号，会带来空资料；只用有值的字段覆盖，不抹掉已有头像和昵称
export function mergeProfile(previous, profile) {
  const nickname =
    typeof profile?.nickname === 'string' ? profile.nickname.slice(0, 100) : ''
  const avatar =
    typeof profile?.avatar === 'string' && /^https:\/\//i.test(profile.avatar)
      ? profile.avatar
      : ''
  return {
    nickname: nickname || previous?.nickname || '',
    avatar: avatar || previous?.avatar || '',
  }
}
