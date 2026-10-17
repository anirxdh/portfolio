#!/usr/bin/env bash
# Points each public project repo's "Website" field at its deep-dive article on anirudhvasudevan.com,
# and the GitHub profile "Website" at the site. Review, then run:  bash scripts/link-repos.sh
# Undo a repo:  gh repo edit anirxdh/<repo> --homepage ""
set -euo pipefail

gh repo edit anirxdh/CIVS --homepage "https://anirudhvasudevan.com/blog/civs-contactless-voting-patent/"
gh repo edit anirxdh/Director-FAL --homepage "https://anirudhvasudevan.com/blog/director-fal-voice-video-editor/"
gh repo edit anirxdh/facetime-from-mars-2159 --homepage "https://anirudhvasudevan.com/blog/facetime-from-mars/"
gh repo edit anirxdh/JungleSafari --homepage "https://anirudhvasudevan.com/blog/jungle-safari-prewarmed-voice-quiz/"
gh repo edit anirxdh/YC-hack --homepage "https://anirudhvasudevan.com/blog/lark-multi-agent-mcp/"
gh repo edit anirxdh/Living-Photos --homepage "https://anirudhvasudevan.com/blog/living-photos-gaussian-splats/"
gh repo edit anirxdh/Moss-hack-yc --homepage "https://anirudhvasudevan.com/blog/moss-voice-cpa-yc-hackathon/"
gh repo edit anirxdh/hearth-native --homepage "https://anirudhvasudevan.com/blog/rua-caregiver-app-offline-first/"
gh repo edit anirxdh/Treeline --homepage "https://anirudhvasudevan.com/blog/screensense-v1-talk-to-your-screen/"
gh repo edit anirxdh/elevenlab_firecrawl --homepage "https://anirudhvasudevan.com/blog/screensense-voice-browser-agent/"
gh repo edit anirxdh/spotify-for-hackers --homepage "https://anirudhvasudevan.com/blog/spotify-for-hackers-ai-dj/"
gh repo edit anirxdh/Voice-companion --homepage "https://anirudhvasudevan.com/blog/super-nova-voice-companion/"
gh repo edit anirxdh/TalkativePDF --homepage "https://anirudhvasudevan.com/blog/talkativepdf-rag-chat/"
gh repo edit anirxdh/The-missing-angle --homepage "https://anirudhvasudevan.com/blog/the-missing-angle-voice-mystery/"
gh repo edit anirxdh/portfolio --homepage "https://anirudhvasudevan.com/"

# Profile "Website" field (currently https://github.com/anirxdh):
gh api -X PATCH user -f blog="https://anirudhvasudevan.com" >/dev/null
echo "done"
