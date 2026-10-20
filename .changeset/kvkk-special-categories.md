---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-document-scanner": patch
---

KVKK Art. 6 special categories and the `KVKK_SENSITIVE` preset ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).

- guard-core: nine new detectors. `health`, `religion_belief`, `ethnic_origin`, `political_opinion`, `union_membership`, `criminal_record`, `sex_life`, `biometric` and `genetic` mask as `[SAĞLIK]`, `[DİN-İNANÇ]`, `[ETNİK-KÖKEN]`, `[SİYASİ-GÖRÜŞ]`, `[SENDİKA]`, `[SABIKA]`, `[CİNSEL-HAYAT]`, `[BİYOMETRİK]` and `[GENETİK]`.
- How they work: a Turkish and English term list per category, plus a context rule. A term is masked only when the text is about a person: a name from the NER lookup, a personal identifier, or a word that points at someone. The mask grows over the phrase around the term.
- They are opt-in. They are in no preset except the new `KVKK_SENSITIVE` (`KVKK` plus these), and can also be turned on by name. New exports: `SPECIAL_CATEGORIES` and `SPECIAL_CATEGORY_REPLACEMENT`.
- security-proxy: `preset: KVKK_SENSITIVE` and the category names are accepted in config. Findings count as personal data in `piiHits`, taint and hooks.
- document-scanner: the same categories count as personal data.
- pii-bench has a new hand-written `tr-special-challenge` set. With the name model, per-category F1 there is 86–100, and its clean lines get no false alarms.
