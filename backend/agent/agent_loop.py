"""AI Agent loop — multi-provider tool_use loop for game analysis.

Supports: Claude, OpenAI, Gemini, DeepSeek (all via tool_use / function calling).
"""

import asyncio
import json
import logging
import threading
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# Pricing per 1M tokens (USD) — rough estimates for cost display
_PRICING: dict[str, dict[str, float]] = {
    # Claude
    "claude-sonnet-4-6-20250514": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 0.25, "output": 1.25},
    "claude-haiku-4-20250414": {"input": 0.8, "output": 4.0},
    "claude-opus-4-6-20250515": {"input": 15.0, "output": 75.0},
    "claude-opus-4-20250514": {"input": 15.0, "output": 75.0},
    # OpenAI
    "gpt-4o": {"input": 2.5, "output": 10.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4.1": {"input": 2.0, "output": 8.0},
    "gpt-4.1-mini": {"input": 0.4, "output": 1.6},
    "o4-mini": {"input": 1.1, "output": 4.4},
    # Gemini
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.0},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    # DeepSeek
    "deepseek-chat": {"input": 0.14, "output": 0.28},
    "deepseek-reasoner": {"input": 0.55, "output": 2.19},
    # Fallback
    "default": {"input": 1.0, "output": 5.0},
}

SYSTEM_PROMPT = """\
You are a game file analysis expert embedded in a game translation tool.
Your job is to analyze game files and figure out how to extract translatable strings.

## Available Tools
- list_files: Browse the game directory
- read_file: Read file contents (text or binary hex)
- detect_engine: Use the built-in engine detector
- scan_game: Use the built-in scanner for a known engine
- extract_strings: Use the built-in string extractor
- try_parse: Parse files with json/xml/csv/ini/binary_pattern/regex
- save_strings: Save extracted strings to the app database for translation
- start_translation: Start the translation pipeline for saved strings

## Strategy
1. Start by listing the root directory to understand the game structure
2. Try detect_engine first — if a known engine is found, use scan_game and extract_strings
3. If the engine is unknown or extraction fails:
   a. Look for common game data files (*.json, *.xml, *.csv, *.txt, *.dat, etc.)
   b. Read promising files to identify the text format
   c. Use try_parse with appropriate methods
   d. Look for patterns: string tables, dialogue files, script files
4. For binary files, read the header to identify the format, then use binary_pattern to find text markers
5. Common patterns in Japanese games:
   - Shift-JIS encoded text files
   - CSV/TSV dialogue files
   - JSON scenario files
   - Custom binary with length-prefixed strings
   - Wolf RPG: .wolf files with DX archive headers
   - KiriKiri: .xp3 archives
   - RPG Maker: .json in www/data/

## Saving & Translating Strings
After extracting strings, ALWAYS use save_strings to save them to the database.
- Include the file path each string came from (helps with re-applying translations later)
- Use meaningful tags: dialogue, ui, system, item, skill, menu, description, etc.
- You can call save_strings multiple times (append mode). Duplicates are auto-skipped.
- Max 5000 strings per call. For larger sets, split into multiple calls.

If the user asks you to translate (e.g. "번역해", "translate this game"), after saving strings:
- Call start_translation to kick off the translation pipeline
- The pipeline runs in the background using the same API key you are using
- Tell the user that translation has started and they can monitor progress in the app

## Interaction
- You can ask the user questions — they will reply.
- When you stop using tools and output text, the user gets a chance to respond.
- If the user gives instructions, follow them.
- If the user says nothing useful, continue analysis on your own.

## Output
When you finish analysis, provide a clear summary:
- What engine/format was detected
- Where translatable strings are located
- The file format and encoding
- How many strings were found (if extracted)
- Recommended approach for translation

Be thorough but efficient. Don't waste turns on irrelevant files.\
"""

# How long to wait for user input before auto-continuing (seconds)
USER_INPUT_TIMEOUT = 300  # 5 minutes


def _detect_provider(model: str) -> str:
    """Detect provider from model name."""
    m = model.lower()
    if m.startswith("claude"):
        return "claude"
    elif m.startswith("gpt-") or m.startswith("o4") or m.startswith("o3") or m.startswith("o1"):
        return "openai"
    elif m.startswith("gemini"):
        return "gemini"
    elif m.startswith("deepseek"):
        return "deepseek"
    return "claude"  # fallback


class AIAgent:
    """Interactive multi-provider tool_use agent — pauses on end_turn for user input."""

    def __init__(
        self,
        api_key: str,
        model: str,
        game_path: str,
        game_title: str = "",
        game_id: int = 0,
        max_turns: int = 20,
        instructions: str = "",
        provider: str = "",
        broadcast: Optional[Callable[[str, dict], None]] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.provider = provider or _detect_provider(model)
        self.game_path = game_path
        self.game_title = game_title
        self.game_id = game_id
        self.max_turns = min(max_turns, 50)
        self.instructions = instructions
        self._broadcast = broadcast or (lambda event, data: None)
        self.cancel_event = threading.Event()

        # User message injection
        self._user_message: Optional[str] = None
        self._user_message_event = asyncio.Event()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Token tracking
        self.input_tokens = 0
        self.output_tokens = 0
        self.turns = 0
        self.messages: list[dict] = []

    def _get_pricing(self) -> dict:
        return _PRICING.get(self.model, _PRICING["default"])

    @property
    def estimated_cost_usd(self) -> float:
        p = self._get_pricing()
        return (self.input_tokens * p["input"] + self.output_tokens * p["output"]) / 1_000_000

    def send_user_message(self, text: str) -> None:
        """Inject a user message (called from another thread)."""
        self._user_message = text
        if self._loop:
            self._loop.call_soon_threadsafe(self._user_message_event.set)

    async def run(self) -> dict:
        """Run the interactive agent loop — dispatches to the right provider."""
        self._loop = asyncio.get_event_loop()

        if self.provider == "claude":
            return await self._run_claude()
        elif self.provider in ("openai", "deepseek"):
            return await self._run_openai_compat()
        elif self.provider == "gemini":
            return await self._run_gemini()
        else:
            error_msg = f"Unsupported provider: {self.provider}"
            self._broadcast("error", {"message": error_msg})
            return {"error": error_msg, "status": "error"}

    # ------------------------------------------------------------------
    # Claude (Anthropic SDK)
    # ------------------------------------------------------------------
    async def _run_claude(self) -> dict:
        from .tools import TOOL_DEFINITIONS, execute_tool

        try:
            import anthropic
        except ImportError:
            self._broadcast("error", {"message": "anthropic SDK not installed. pip install anthropic"})
            return {"error": "anthropic SDK not installed", "status": "error"}

        client = anthropic.Anthropic(api_key=self.api_key)
        system_text = self._build_system_prompt()

        self.messages = [{"role": "user", "content": self._initial_user_message()}]
        self._broadcast("started", {"model": self.model, "max_turns": self.max_turns, "game_path": self.game_path})

        last_text = ""

        while self.turns < self.max_turns:
            if self.cancel_event.is_set():
                self._broadcast("cancelled", {"turns": self.turns})
                return self._make_result("cancelled", last_text)

            self.turns += 1
            self._broadcast("thinking", {"turn": self.turns})

            try:
                response = await asyncio.to_thread(
                    client.messages.create,
                    model=self.model,
                    max_tokens=4096,
                    system=system_text,
                    tools=TOOL_DEFINITIONS,
                    messages=self.messages,
                )
            except Exception as e:
                error_msg = f"API error: {type(e).__name__}: {e}"
                self._broadcast("error", {"message": error_msg, "turn": self.turns})
                return self._make_result("error", last_text, error=error_msg)

            if hasattr(response, "usage"):
                self.input_tokens += response.usage.input_tokens
                self.output_tokens += response.usage.output_tokens

            self._broadcast("tokens", {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "cost_usd": round(self.estimated_cost_usd, 4),
                "turn": self.turns,
            })

            assistant_content = []
            tool_uses = []

            for block in response.content:
                if block.type == "text":
                    last_text = block.text
                    assistant_content.append({"type": "text", "text": block.text})
                    self._broadcast("text", {"text": block.text, "turn": self.turns})
                elif block.type == "tool_use":
                    tool_uses.append(block)
                    assistant_content.append({
                        "type": "tool_use", "id": block.id,
                        "name": block.name, "input": block.input,
                    })
                    self._broadcast("tool_call", {
                        "tool": block.name, "input": block.input,
                        "tool_use_id": block.id, "turn": self.turns,
                    })

            self.messages.append({"role": "assistant", "content": assistant_content})

            if response.stop_reason == "end_turn" or not tool_uses:
                result = await self._handle_end_turn(last_text)
                if result:
                    return result
                continue

            tool_results = await self._execute_tools_claude(tool_uses)
            self.messages.append({"role": "user", "content": tool_results})

        self._broadcast("complete", self._stats(f"Max turns ({self.max_turns}) reached.\n{last_text}"))
        return self._make_result("completed", last_text)

    async def _execute_tools_claude(self, tool_uses: list) -> list[dict]:
        from .tools import execute_tool
        tool_results = []
        for tool_block in tool_uses:
            if self.cancel_event.is_set():
                break
            result = await execute_tool(tool_block.name, tool_block.input, self.game_path, self.game_id, self._agent_context)
            result_str = json.dumps(result, ensure_ascii=False, default=str)
            if len(result_str) > 30000:
                result_str = result_str[:30000] + "\n... [truncated]"
                result = {"_truncated": True, "content": result_str}

            tool_results.append({
                "type": "tool_result", "tool_use_id": tool_block.id,
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })
            self._broadcast("tool_result", {
                "tool": tool_block.name, "tool_use_id": tool_block.id,
                "result": result, "turn": self.turns,
            })
        return tool_results

    # ------------------------------------------------------------------
    # OpenAI-compatible (OpenAI, DeepSeek)
    # ------------------------------------------------------------------
    async def _run_openai_compat(self) -> dict:
        from .tools import TOOL_DEFINITIONS_OPENAI, execute_tool

        try:
            import openai
        except ImportError:
            self._broadcast("error", {"message": "openai SDK not installed. pip install openai"})
            return {"error": "openai SDK not installed", "status": "error"}

        base_url = None
        if self.provider == "deepseek":
            base_url = "https://api.deepseek.com"

        client = openai.OpenAI(api_key=self.api_key, base_url=base_url)
        system_text = self._build_system_prompt()

        self.messages = [
            {"role": "system", "content": system_text},
            {"role": "user", "content": self._initial_user_message()},
        ]
        self._broadcast("started", {"model": self.model, "max_turns": self.max_turns, "game_path": self.game_path})

        last_text = ""

        while self.turns < self.max_turns:
            if self.cancel_event.is_set():
                self._broadcast("cancelled", {"turns": self.turns})
                return self._make_result("cancelled", last_text)

            self.turns += 1
            self._broadcast("thinking", {"turn": self.turns})

            try:
                response = await asyncio.to_thread(
                    client.chat.completions.create,
                    model=self.model,
                    max_tokens=4096,
                    tools=TOOL_DEFINITIONS_OPENAI,
                    messages=self.messages,
                )
            except Exception as e:
                error_msg = f"API error: {type(e).__name__}: {e}"
                self._broadcast("error", {"message": error_msg, "turn": self.turns})
                return self._make_result("error", last_text, error=error_msg)

            choice = response.choices[0]
            msg = choice.message

            if hasattr(response, "usage") and response.usage:
                self.input_tokens += response.usage.prompt_tokens or 0
                self.output_tokens += response.usage.completion_tokens or 0

            self._broadcast("tokens", {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "cost_usd": round(self.estimated_cost_usd, 4),
                "turn": self.turns,
            })

            # Text content
            if msg.content:
                last_text = msg.content
                self._broadcast("text", {"text": msg.content, "turn": self.turns})

            # Tool calls
            tool_calls = msg.tool_calls or []
            if tool_calls:
                for tc in tool_calls:
                    self._broadcast("tool_call", {
                        "tool": tc.function.name,
                        "input": json.loads(tc.function.arguments) if tc.function.arguments else {},
                        "tool_use_id": tc.id, "turn": self.turns,
                    })

            # Append assistant message
            self.messages.append(msg.model_dump())

            if choice.finish_reason == "stop" or not tool_calls:
                result = await self._handle_end_turn(last_text)
                if result:
                    return result
                continue

            # Execute tools
            for tc in tool_calls:
                if self.cancel_event.is_set():
                    break
                args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                result = await execute_tool(tc.function.name, args, self.game_path, self.game_id, self._agent_context)
                result_str = json.dumps(result, ensure_ascii=False, default=str)
                if len(result_str) > 30000:
                    result_str = result_str[:30000] + "\n... [truncated]"

                self.messages.append({
                    "role": "tool", "tool_call_id": tc.id,
                    "content": result_str,
                })
                self._broadcast("tool_result", {
                    "tool": tc.function.name, "tool_use_id": tc.id,
                    "result": result, "turn": self.turns,
                })

        self._broadcast("complete", self._stats(f"Max turns ({self.max_turns}) reached.\n{last_text}"))
        return self._make_result("completed", last_text)

    # ------------------------------------------------------------------
    # Google Gemini
    # ------------------------------------------------------------------
    async def _run_gemini(self) -> dict:
        from .tools import TOOL_DEFINITIONS_GEMINI, execute_tool

        try:
            from google import genai
            from google.genai import types
        except ImportError:
            self._broadcast("error", {"message": "google-genai SDK not installed. pip install google-genai"})
            return {"error": "google-genai SDK not installed", "status": "error"}

        client = genai.Client(api_key=self.api_key)
        system_text = self._build_system_prompt()

        # Build tool declarations
        tools = types.Tool(function_declarations=TOOL_DEFINITIONS_GEMINI)

        self._broadcast("started", {"model": self.model, "max_turns": self.max_turns, "game_path": self.game_path})

        contents = [types.Content(role="user", parts=[types.Part.from_text(self._initial_user_message())])]
        last_text = ""

        while self.turns < self.max_turns:
            if self.cancel_event.is_set():
                self._broadcast("cancelled", {"turns": self.turns})
                return self._make_result("cancelled", last_text)

            self.turns += 1
            self._broadcast("thinking", {"turn": self.turns})

            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_text,
                        tools=[tools],
                        temperature=0.3,
                    ),
                )
            except Exception as e:
                error_msg = f"API error: {type(e).__name__}: {e}"
                self._broadcast("error", {"message": error_msg, "turn": self.turns})
                return self._make_result("error", last_text, error=error_msg)

            # Token tracking
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                um = response.usage_metadata
                self.input_tokens += getattr(um, "prompt_token_count", 0) or 0
                self.output_tokens += getattr(um, "candidates_token_count", 0) or 0

            self._broadcast("tokens", {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "cost_usd": round(self.estimated_cost_usd, 4),
                "turn": self.turns,
            })

            if not response.candidates:
                self._broadcast("complete", self._stats(last_text or "No response"))
                return self._make_result("completed", last_text)

            candidate = response.candidates[0]
            parts = candidate.content.parts if candidate.content else []

            function_calls = []
            for part in parts:
                if part.text:
                    last_text = part.text
                    self._broadcast("text", {"text": part.text, "turn": self.turns})
                if part.function_call:
                    function_calls.append(part)
                    fc = part.function_call
                    self._broadcast("tool_call", {
                        "tool": fc.name,
                        "input": dict(fc.args) if fc.args else {},
                        "tool_use_id": fc.name, "turn": self.turns,
                    })

            # Add model response to history
            contents.append(candidate.content)

            if not function_calls:
                result = await self._handle_end_turn(last_text)
                if result:
                    return result
                # Add user message to contents
                contents.append(types.Content(
                    role="user",
                    parts=[types.Part.from_text(self.messages[-1]["content"] if self.messages and self.messages[-1]["role"] == "user" else "continue")],
                ))
                continue

            # Execute tools and build response parts
            response_parts = []
            for part in function_calls:
                if self.cancel_event.is_set():
                    break
                fc = part.function_call
                args = dict(fc.args) if fc.args else {}
                result = await execute_tool(fc.name, args, self.game_path, self.game_id, self._agent_context)
                result_str = json.dumps(result, ensure_ascii=False, default=str)
                if len(result_str) > 30000:
                    result_str = result_str[:30000] + "\n... [truncated]"

                response_parts.append(types.Part.from_function_response(
                    name=fc.name,
                    response={"result": result_str},
                ))
                self._broadcast("tool_result", {
                    "tool": fc.name, "tool_use_id": fc.name,
                    "result": result, "turn": self.turns,
                })

            contents.append(types.Content(role="user", parts=response_parts))

        self._broadcast("complete", self._stats(f"Max turns ({self.max_turns}) reached.\n{last_text}"))
        return self._make_result("completed", last_text)

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------
    @property
    def _agent_context(self) -> dict:
        """Context passed to tools that need agent credentials (e.g. start_translation)."""
        return {"api_key": self.api_key, "provider": self.provider, "model": self.model}

    def _build_system_prompt(self) -> str:
        text = SYSTEM_PROMPT
        if self.game_title:
            text += f"\n\n## Current Game\nTitle: {self.game_title}\nPath: {self.game_path}"
        if self.instructions:
            text += f"\n\n## Additional Instructions from User\n{self.instructions}"
        return text

    def _initial_user_message(self) -> str:
        return (
            "Please analyze this game and find all translatable strings. "
            "The game is located at the path provided in the system prompt. "
            "Start by exploring the file structure."
        )

    async def _handle_end_turn(self, last_text: str) -> Optional[dict]:
        """Handle end_turn: wait for user input. Returns result dict if done, None to continue."""
        self._broadcast("waiting", {
            "text": last_text, "turn": self.turns,
            "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
            "cost_usd": round(self.estimated_cost_usd, 4),
        })

        user_text = await self._wait_for_user_input()

        if self.cancel_event.is_set():
            self._broadcast("cancelled", {"turns": self.turns})
            return self._make_result("cancelled", last_text)

        if user_text is None:
            self._broadcast("complete", self._stats(last_text))
            return self._make_result("completed", last_text)

        self._broadcast("user_message", {"text": user_text, "turn": self.turns})
        self.messages.append({"role": "user", "content": user_text})
        return None

    async def _wait_for_user_input(self) -> Optional[str]:
        """Wait for user input or timeout. Returns None on timeout."""
        self._user_message_event.clear()
        self._user_message = None
        try:
            await asyncio.wait_for(self._user_message_event.wait(), timeout=USER_INPUT_TIMEOUT)
            return self._user_message
        except asyncio.TimeoutError:
            return None

    def _stats(self, summary: str) -> dict:
        return {
            "summary": summary, "turns": self.turns,
            "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
            "cost_usd": round(self.estimated_cost_usd, 4),
        }

    def _make_result(self, status: str, summary: str, error: str = "") -> dict:
        return {
            "status": status, "summary": summary, "error": error,
            "turns": self.turns, "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens, "cost_usd": round(self.estimated_cost_usd, 4),
        }
