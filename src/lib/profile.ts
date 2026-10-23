export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 10;

const NICKNAME_PATTERN = /^[\p{L}\p{N}\s._-]+$/u;

export function normalizeNickname(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function validateNickname(input: string): {
  valid: boolean;
  nickname: string;
  message?: string;
} {
  const nickname = normalizeNickname(input);

  if (!nickname) {
    return {
      valid: false,
      nickname,
      message: "Никнейм не может быть пустым."
    };
  }

  if (nickname.length < NICKNAME_MIN_LENGTH) {
    return {
      valid: false,
      nickname,
      message: "Никнейм слишком короткий."
    };
  }

  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return {
      valid: false,
      nickname,
      message: "Никнейм слишком длинный."
    };
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return {
      valid: false,
      nickname,
      message: "Можно использовать только буквы, цифры, пробел, точку, подчёркивание и дефис."
    };
  }

  return {
    valid: true,
    nickname
  };
}
