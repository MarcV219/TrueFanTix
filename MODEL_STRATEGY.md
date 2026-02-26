# TrueFantix Model Management Strategy

## 3-Tier Model Routing

### Tier 1: Free Ollama Models (Local)
**Use for:** Routine tasks, cron jobs, general discussions
- **Models:** Mistral, Qwen25, QwenCoder
- **Cost:** $0 (runs on your MiniPC)
- **When to use:**
  - Daily cron jobs (budget checks, escrow timeouts)
  - Simple Q&A and status updates
  - File operations and system maintenance
  - Testing and validation

### Tier 2: GPT 5.2 (Deep Reasoning)
**Use for:** Complex analysis, strategic planning, troubleshooting
- **Model:** openai/gpt-5.2
- **Cost:** Medium (Pro plan includes generous limits)
- **When to use:**
  - Architecture decisions
  - Complex debugging
  - Performance optimization
  - Security reviews
  - Data analysis and insights

### Tier 3: GPT 5.3-Codex (High-End Coding)
**Use for:** Complex development, production code, critical features
- **Model:** openai/gpt-5.3-codex
- **Cost:** Higher (but worth it for quality)
- **When to use:**
  - Production feature development
  - Complex API integrations
  - Database schema design
  - Critical bug fixes
  - Code reviews and refactoring

## Configuration Commands

### Set Default Model (Ollama for routine tasks)
```bash
openclaw models set ollama/mistral
```

### Switch to GPT 5.2 for deep reasoning
```bash
openclaw models set openai/gpt-5.2
```

### Switch to GPT 5.3-Codex for coding
```bash
openclaw models set openai-codex/gpt-5.3-codex
```

## Cost Optimization Tips

1. **Start with Ollama** for all tasks
2. **Escalate to GPT 5.2** only when:
   - Ollama can't solve the problem
   - Deep reasoning is required
   - Working on architecture/strategy
3. **Escalate to GPT 5.3-Codex** only when:
   - Writing production code
   - Complex integrations
   - Critical features

## Pro Plan Benefits
- Higher rate limits
- Priority access during peak times
- Better context window handling
- More reliable for mission-critical tasks

## Cron Job Strategy
All cron jobs should use Ollama models by default:
- Budget checks: `ollama/mistral`
- Escrow timeouts: `ollama/mistral`
- Update checks: `ollama/mistral`

This keeps your operational costs at $0 for automated tasks.
