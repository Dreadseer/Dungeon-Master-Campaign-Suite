#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Anthropic({
  baseURL: 'http://localhost:1234',
  apiKey: 'lmstudio',
});

const MODEL_OVERRIDE = 'lmstudio-community/Llama-3.2-1B-Instruct-GGUF';

async function getModel() {
  if (MODEL_OVERRIDE) return MODEL_OVERRIDE;
  try {
    const res = await fetch('http://localhost:1234/api/v0/models');
    const data = await res.json();
    const loaded = data.data?.find(m => m.state === 'loaded');
    return loaded?.id ?? data.data?.[0]?.id ?? 'gemma-4';
  } catch {
    return 'gemma-4';
  }
}

const SYSTEM = `You are a Dungeon Master's assistant — a knowledgeable, creative companion helping a DM run and explore their D&D 5e campaign.

Your role is to help the DM:
- Explore and develop their campaign world: locations, factions, lore, history
- Bring NPCs to life: personalities, motivations, secrets, voices
- Build and balance encounters: monster selection, terrain, tactics, XP
- Generate ideas: plot hooks, twists, random events, consequences
- Rule calls: answer D&D 5e rules questions accurately and concisely
- Improvise: help the DM respond when players go off-script
- Recap and foreshadow: summarize past events, tease upcoming ones

## Tone
- Speak like a creative collaborator, not a textbook
- Be specific — generic advice is less useful than concrete suggestions
- When generating NPCs, locations, or encounters, give them texture: a name, a detail, a twist
- Keep responses focused and actionable; the DM is at the table or prepping for it

## D&D 5e knowledge
You know the rules, monsters, spells, classes, conditions, action economy, and encounter math (XP thresholds, CR, multimonster adjustments). Cite specific rules when it matters; hand-wave when it doesn't.

## What you don't know
You don't have direct access to this DM's campaign data. If they share details about their world, NPCs, or players, use that context throughout the conversation. Ask clarifying questions when it helps you give better answers.`;

async function ask(model, history, userMessage) {
  history.push({ role: 'user', content: userMessage });

  const response = await client.messages.create({
    model,
    system: SYSTEM,
    messages: history,
    max_tokens: 2048,
    temperature: 0.7,
  });

  const reply = response.content.find(b => b.type === 'text')?.text ?? '';
  history.push({ role: 'assistant', content: reply });
  return reply;
}

async function main() {
  const model = await getModel();
  console.log(`DM Assistant — model: ${model}`);
  console.log('Ask anything about your campaign. Type "exit" to quit.\n');

  const history = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('DM: ', async input => {
      const q = input.trim();
      if (!q || q.toLowerCase() === 'exit') { rl.close(); return; }

      try {
        const answer = await ask(model, history, q);
        console.log(`\nAssistant: ${answer}\n`);
      } catch (e) {
        console.error(`Error: ${e.message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
