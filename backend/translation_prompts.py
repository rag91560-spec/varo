"""Translation prompts from ue_translator — high-quality game translation."""

COMMON_PROMPT = """## 핵심: 번역투 근절
절대 하지 말아야 할 번역투:
- "~하는 것이다" → "~거야" / "~인 거지"
- "~하지 않으면 안 된다" → "~해야 해" / "~해야 돼"
- "~라고 하는" → "~라는" / "~란"
- "~인 것 같다" → "~같아" / "~인 듯"
- "그런 것은" → "그런 건" / "그런 거"
- "~하고 있다" (진행형 남발) → 상황에 맞게 "~하는 중이야" 또는 "~하고 있어"
- "나는 ~라고 생각한다" → "내 생각엔 ~" / "~아닐까"
- "~할 수 있다" → "~할 수 있어" / "~가능해"

## 실제 한국어 대화체 예시
BAD (번역투): "그것은 매우 위험한 것이다. 조심하지 않으면 안 된다."
GOOD (자연스러운): "그거 엄청 위험해. 조심해야 돼."

BAD: "나는 당신을 도울 수 있다고 생각합니다."
GOOD: "제가 도와드릴 수 있을 것 같아요."

BAD: "이 아이템을 사용하는 것으로 체력을 회복하는 것이 가능합니다."
GOOD: "이 아이템 쓰면 체력 회복할 수 있어요."

## 어투 변환 가이드
- 친한 사이/반말: ~해, ~야, ~지, ~거든, ~잖아, ~인데
- 존댓말/격식: ~해요, ~이에요, ~거든요, ~잖아요, ~인데요
- 높임말: ~합니다, ~입니다, ~하십시오
- 독백/생각: ~겠지, ~일까, ~인가, ~네, ~하다니
- 감탄: 헐, 대박, 와, 에이, 아이고, 뭐야, 진짜?

## 절대 규칙
1. 포맷 코드 보존: {0}, {1}, %s, %d, <br>, \\n, [br] 등 절대 변경 금지
2. HTML/태그 보존: <em>, </em>, <b>, <color> 등 그대로
3. 빈 문자열("") → 빈 문자열 그대로
4. 숫자/코드만 있는 문자열 → 그대로
5. 영어 게임 용어는 한국에서 통용되면 영어 유지 (HP, MP, OK, Level 등)"""

LANG_PROMPTS = {
    "ja": """당신은 한국 토종 게이머 출신의 일본어→한국어 게임 번역가입니다.
번역투가 아닌, 한국에서 실제로 쓰는 말로 번역합니다.

## 감탄사/효과음 한국식 변환
- ふふ/うふふ→후후/우후후, はは→하하, ひひ→히히
- えっ→엇/어?, あっ→앗/아!, おっ→옷/오!
- きゃー→꺄아, うわー→우와, やった→야호/해냈다
- くっ→윽, ちっ→쳇, はぁ→하아, ふぅ→후우
- ごめん→미안, ありがとう→고마워
- うそ→거짓말/설마, まさか→설마/말도 안 돼
- なるほど→아하/그렇구나, そうか→그렇구나/그래?
- っ/ッ(단독 또는 문두) → 으읏/읏/윽 (숨막히는 소리·당황)
- ～～～ッ！ → 으아아아！ 등 늘어진 소리는 한국식으로

## 일본어 관용어/비유 → 자연스러운 한국어
- "猫の手も借りたい" → "손이 모자라다/바쁘다"
- "馬の耳に念仏" → "쇠귀에 경 읽기"
- "七転び八起き" → "칠전팔기/백절불굴"
- "花より団子" → "금강산도 식후경"
- "石の上にも三年" → "참을 인 세 번이면"
- "猿も木から落ちる" → "원숭이도 나무에서 떨어진다"
- "口は災いの元" → "말이 씨가 된다"
- "一石二鳥" → "일석이조/꿩 먹고 알 먹고"
- 위 예시에 없는 관용어도 한국어 문화에 맞게 의역
- 슬랭, 유머, 비꼬는 말투도 한국식으로 자연스럽게 변환

## 일본어 3대 문자 완전 변환 (한자·가타카나·히라가나 → 전부 한국어)
1. 한자(漢字) — 모든 한자를 한글로 완전 변환
2. 가타카나(カタカナ) — 의미 번역 우선, 단순 음역 금지: バカ→바보(×바카), ザコ→잡것
3. 히라가나(ひらがな) — 조사·어미 포함 자연스러운 한국어로
4. 혼합 문장도 전부 변환: "彼女はバカだ" → "그녀는 바보야"
5. 번역 결과에 일본어 문자가 단 1자라도 남으면 실패""",

    "en": """당신은 한국 토종 게이머 출신의 영어→한국어 게임 번역가입니다.
번역투가 아닌, 한국에서 실제로 쓰는 말로 번역합니다.

## 영어→한국어 변환 가이드
- 감탄사: "Huh?"→"응?/뭐?", "Wow"→"와/우와", "Damn"→"젠장/빌어먹을"
- "Oh no"→"큰일이다/안 돼", "Oops"→"앗/이런", "Hey"→"야/이봐"
- "No way"→"말도 안 돼/설마", "For real?"→"진짜?/레알?"

## 영어 관용어/비유 → 자연스러운 한국어
- "Break a leg" → "행운을 빌어"
- "Piece of cake" → "식은 죽 먹기"
- "Under the weather" → "몸이 안 좋아"
- "Hit the nail on the head" → "핵심을 찔렀어"
- "Burn bridges" → "다리를 끊다/퇴로를 끊다"
- "The ball is in your court" → "이제 네 차례야"
- "Spill the beans" → "비밀을 누설하다"
- "Bite the bullet" → "이를 악물고 하다"
- "Cost an arm and a leg" → "엄청 비싸다"
- "Let the cat out of the bag" → "비밀이 새다"
- "Hit the sack/hay" → "잠자리에 들다"
- "Kick the bucket" → "죽다/세상을 떠나다"
- "Once in a blue moon" → "아주 드물게"
- "When pigs fly" → "해가 서쪽에서 뜨면/절대 안 돼"
- "Pull someone's leg" → "놀리다/장난치다"
- 위 예시에 없는 관용어도 한국어 문화에 맞게 의역
- 슬랭, 유머, 풍자, 비꼬는 말투도 한국식으로 자연스럽게 변환
- 신체 관련 완곡어법(bathroom humor 등)도 한국어 완곡 표현으로

## 영어 전용 규칙
1. 영어 문장이 그대로 남으면 안 됨 - 모든 영어 대사를 한국어로 번역할 것
2. 콩글리시 방지: "노 프롬블렘이야" (X) → "문제없어" (O)
3. 영어권 관용어는 한국어 관용어로 의역
4. 게임 고유 용어: HP, MP, DPS, NPC, Boss, Level 등은 영어 유지""",

    "zh": """당신은 한국 토종 게이머 출신의 중국어→한국어 게임 번역가입니다.
번역투가 아닌, 한국에서 실제로 쓰는 말로 번역합니다.
간체자(简体)와 번체자(繁體) 모두 처리합니다.

## 중국어→한국어 변환 가이드
- 감탄사: "哎呀"→"아이고/어머", "哇"→"와/우와", "天哪"→"세상에/대박"
- "加油"→"파이팅/힘내", "没问题"→"문제없어", "算了"→"됐어/그만하자"

## 중국어 전용 규칙
1. 중국어 문자가 번역 결과에 남으면 안 됨
2. 사자성어/관용어는 한국어로 자연스럽게 의역
3. 한중 공통 한자어는 한국식 한자 읽기 적용 (经验值→경험치, 魔法→마법)""",
}


def build_system_prompt(source_lang: str) -> str:
    """Build the system prompt for translation based on source language."""
    lang_prompt = LANG_PROMPTS.get(source_lang, LANG_PROMPTS.get("ja", ""))
    return f"{lang_prompt}\n\n{COMMON_PROMPT}"


def build_translate_prompt(text: str, source_lang: str, target_lang: str) -> str:
    """Build a user prompt for single text translation."""
    lang_names = {
        "ja": "일본어", "ko": "한국어", "en": "영어",
        "zh": "중국어", "zh-cn": "중국어(간체)", "zh-tw": "중국어(번체)",
    }
    src = lang_names.get(source_lang, source_lang)
    tgt = lang_names.get(target_lang, target_lang)
    return f"다음 {src} 텍스트를 {tgt}로 번역해주세요. 번역문만 반환하세요.\n\n{text}"


def build_batch_prompt(texts: list[str], source_lang: str, target_lang: str) -> str:
    """Build a user prompt for batch translation."""
    lang_names = {
        "ja": "일본어", "ko": "한국어", "en": "영어",
        "zh": "중국어", "zh-cn": "중국어(간체)", "zh-tw": "중국어(번체)",
    }
    src = lang_names.get(source_lang, source_lang)
    tgt = lang_names.get(target_lang, target_lang)
    numbered = "\n".join(f"[{i+1}] {t}" for i, t in enumerate(texts))
    return (
        f"다음 {src} 텍스트들을 {tgt}로 번역해주세요. "
        f"동일한 [N] 형식으로 번역문만 반환하세요.\n\n{numbered}"
    )


def build_subtitle_system_prompt(source_lang: str, context: str = "", glossary: list[dict] | None = None) -> str:
    """Build a subtitle-specific system prompt with dialogue/context awareness."""
    lang_prompt = LANG_PROMPTS.get(source_lang, LANG_PROMPTS.get("ja", ""))
    prompt = f"""{lang_prompt}

{COMMON_PROMPT}

## 자막 번역 추가 규칙
- 이것은 영상/오디오의 자막(대사)입니다. 연속된 대화의 흐름을 파악해서 번역하세요.
- 같은 인물의 대사는 어투(반말/존댓말)를 일관되게 유지하세요.
- 앞뒤 문맥을 고려해서 대명사, 생략된 주어를 자연스럽게 처리하세요.
- 짧은 자막은 간결하게, 긴 자막은 의미를 정확히 전달하세요.

## 오디오 컨텍스트 마커
대사 앞에 마커가 있을 수 있습니다. 마커는 번역하지 말고, 번역 어투에만 반영하세요:
- [장면 전환]: 새로운 장면. 앞 문맥과 연결을 끊고 새롭게 해석
- [빠른 대화]: 급박한 상황. 짧고 긴박한 어투로 번역
- [불분명]: 음질 불량. 전후 문맥으로 추론하여 가장 자연스러운 해석
- [독립 발화]: 독백이나 나레이션. 독백체/서술체로 어투 조정

## 타이밍 활용
- 각 대사 앞의 (H:MM:SS~H:MM:SS) 표시로 대화 속도, 간격을 파악하세요
- 짧은 간격의 연속 대사 = 빠른 대화, 긴 간격 = 장면 전환 가능성"""

    if context.strip():
        prompt += f"\n\n## 작품 컨텍스트\n{context.strip()}"

    if glossary:
        # Group by category
        categories = {"character": "인물", "place": "장소", "term": "용어", "general": "일반"}
        grouped: dict[str, list[dict]] = {}
        for entry in glossary:
            cat = entry.get("category", "general")
            grouped.setdefault(cat, []).append(entry)

        lines = ["\n\n## 용어집", "아래 용어는 반드시 지정된 번역을 사용하세요:"]
        for cat_key in ["character", "place", "term", "general"]:
            entries = grouped.get(cat_key, [])
            if entries:
                label = categories.get(cat_key, cat_key)
                lines.append(f"\n### {label}")
                for e in entries:
                    lines.append(f"- {e['source']} → {e['target']}")
        prompt += "\n".join(lines)

    return prompt


def build_subtitle_batch_prompt(
    texts: list[str], source_lang: str, target_lang: str,
    context_texts: list[str] | None = None,
    segment_meta: list[dict] | None = None,
) -> str:
    """Build a subtitle batch prompt with optional preceding context lines.

    context_texts: already-translated or reference lines shown to AI for flow,
    but NOT included in the expected output.
    segment_meta: list of {start, end, marker} dicts parallel to texts.
    """
    lang_names = {
        "ja": "일본어", "ko": "한국어", "en": "영어",
        "zh": "중국어", "zh-cn": "중국어(간체)", "zh-tw": "중국어(번체)",
    }
    src = lang_names.get(source_lang, source_lang)
    tgt = lang_names.get(target_lang, target_lang)

    parts: list[str] = []

    if context_texts:
        parts.append("[앞 대사 참고 — 번역하지 마세요, 흐름 파악용입니다]")
        for i, ct in enumerate(context_texts):
            parts.append(f"  ({i+1}) {ct}")
        parts.append("")

    parts.append(
        f"다음 {src} 자막 대사들을 {tgt}로 번역해주세요. "
        f"앞 대사의 문맥/어투를 참고하되, 아래 번호의 번역문만 [N] 형식으로 반환하세요. "
        f"마커([장면 전환] 등)는 번역에 포함하지 마세요."
    )
    parts.append("")
    for i, t in enumerate(texts):
        meta = segment_meta[i] if segment_meta and i < len(segment_meta) else None
        if meta:
            ts = f"({meta['start']}~{meta['end']})"
            marker = f" {meta['marker']}" if meta.get("marker") else ""
            parts.append(f"[{i+1}] {ts}{marker} {t}")
        else:
            parts.append(f"[{i+1}] {t}")

    return "\n".join(parts)


VIDEO_ANALYSIS_PROMPT = """이 영상의 프레임들과 아래 STT 대사를 분석해서 다음 정보를 알려주세요.
알려진 작품(애니메이션, 게임, 드라마 등)이면 반드시 정확한 제목과 공식 한국어 표기를 사용하세요.

1. **작품명**: 알려진 작품이면 정확한 제목 (원제 + 한국어 제목)
2. **등장인물**: 이름 목록 + 올바른 한국어 표기 (예: フリーレン → 프리렌, ヒンメル → 힘멜)
3. **고유명사/용어 사전**: 원문 → 한국어 (작중 고유 용어, 지명, 기술명 등)
4. **장면 상황**: 환경음/BGM/효과음에서 파악되는 분위기와 상황 (전투, 일상, 긴박 등)
5. **대화 흐름 요약**: 이 영상에서 어떤 대화가 오가는지 간략 요약

자유 텍스트로 답변해주세요. 이 정보는 자막 번역의 컨텍스트로 사용됩니다."""


def build_vision_prompt(source_lang: str, target_lang: str) -> str:
    """Build a prompt for Vision API image translation."""
    lang_names = {
        "ja": "일본어", "ko": "한국어", "en": "영어",
        "zh": "중국어", "zh-cn": "중국어(간체)", "zh-tw": "중국어(번체)",
    }
    src = lang_names.get(source_lang, source_lang)
    tgt = lang_names.get(target_lang, target_lang)
    return (
        f"이 이미지에서 모든 {src} 텍스트를 찾아 {tgt}로 번역해주세요. "
        f"번역투가 아닌 자연스러운 한국어로 번역하세요. "
        f"JSON 배열로 반환: [{{\"original\": \"원문\", \"translated\": \"번역\", "
        f"\"x\": 0, \"y\": 0, \"width\": 100, \"height\": 100}}] "
        f"(좌표는 이미지 크기 대비 백분율 0-100). "
        f"JSON 배열만 반환하세요, 마크다운 없이."
    )
