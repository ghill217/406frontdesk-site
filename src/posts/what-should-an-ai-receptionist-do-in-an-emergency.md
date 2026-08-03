---
title: "What Should an AI Receptionist Do in an Emergency?"
description: "Someone texts your business at 11 PM smelling gas. A patient describes chest pain. Most AI front desks have no answer for this — here's the rule we put above every other rule, and why the order matters."
date: 2026-08-03
---

Most conversations about AI receptionists are about booking rates and missed calls. This one isn't. This is about the small number of messages where getting it wrong matters more than every booking you'll ever take.

Someone texts your HVAC company at 11 PM and says they smell gas. Someone messages a clinic describing chest pain. Someone tells a groomer their dog collapsed. A caller says something that sounds like they're in crisis.

If you're putting an AI on your business line, you need an answer for those before you go live. Here's ours.

## The rule sits above every other rule — and the order is the whole point

Every AI front desk we build carries a safety instruction. What matters is that it's placed **first**, above everything else, including the rule that keeps the bot on topic.

That ordering isn't decoration. It's the fix for a specific failure.

Almost every business bot is told some version of *"only help with topics related to this business."* It's a sensible instruction — it's what stops your receptionist writing someone's homework. But consider an obedient bot, following that rule carefully, that receives a message about chest pain at a chiropractic clinic.

Chest pain isn't a scheduling question. A well-behaved bot could reasonably classify it as **off-topic** and deflect it.

That's the failure. Not malice, not a hallucination — a correct application of a reasonable rule to a message that rule was never meant to cover. The only reliable fix is to put safety *above* scope, so the emergency instruction fires before the bot ever asks itself whether the message is on-topic.

## What it actually does

When something trips that instruction, the receptionist does four things, and only these four:

1. **Tells them to get to safety and call the right number.** Leave the building. Call 911. For a mental-health crisis, 988.
2. **Captures nothing.** No name, no phone number, no lead. It is not a sales moment.
3. **Books nothing.** No appointment, no callback slot, no "we can get you in Tuesday."
4. **Gives no advice.** It doesn't tell you whether to shut a valve, whether the pain sounds serious, or whether the dog will be fine. It is not qualified and neither is the person who built it.

Then it stops. It doesn't pivot back to business. It doesn't try to recover the conversation.

## The harder half: knowing what *isn't* an emergency

Getting the bot to say "call 911" is easy. Getting it to *not* say that is the part that takes real work, and it's where most of the calibration effort goes.

A furnace failing at ten below on a January night is **urgent**. It is not a 911 call. If your receptionist tells that customer to evacuate and dial emergency services, you have a bot nobody trusts, a customer who feels ridiculous, and a job that goes to whoever answered next.

The same distinction runs through every trade and practice:

- **No heat in winter, no hot water, a contained leak** — urgent, get a human on it fast, absolutely capture the details and get them on the schedule.
- **Gas smell, carbon monoxide alarm, sparking panel, smoke** — stop everything, evacuate, 911.
- **Paint damage, a film bubble, a bad haircut** — annoying, sometimes upsetting, not an emergency at all.

Getting those three tiers right for a specific trade is most of the work in setting one of these up properly. It's also the part that's invisible when it's working.

## Why this is worth asking about

If you're evaluating anyone's AI receptionist, this is a good question to ask, because the answer tells you how carefully they build:

> *"What happens if someone messages my business saying they smell gas?"*

There are three kinds of answers. The good one describes a specific instruction, where it sits relative to the other rules, and how they tested it. The concerning one is a vague reassurance that "it would know to escalate." The disqualifying one is surprise that you asked.

We test it before anything goes live — real messages through the real channel, not a sandbox — including deliberately trying to talk the bot out of the safety response afterwards. It should refuse, and then return to normal service conversation as if nothing happened.

## The uncomfortable truth

An AI receptionist is a front desk, not a first responder, and it should never pretend otherwise. Its entire job in an emergency is to get out of the way fast and point at the people who can actually help.

That's a small thing that almost never fires. It's also the thing you'd never forgive yourself for skipping.

If you want to see how ours handles it, [message the demo](/demo/) and tell it something alarming. It's a strange thing to test on purpose, and it's the one worth testing.
