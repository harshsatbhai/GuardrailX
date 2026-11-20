# Orange + White theme - what changed (styling only)

No logic, API, routing, state, backend or data code was touched.

## Theme tokens (frontend/src/index.css, frontend/index.html)
Orange accent #FF6B00 on white (#FFFFFF workspace, #F8F8F8 secondary, #E5E5E5 borders, #111111 text,
#6B6B6B secondary text). Dark mode kept and re-branded: #0D0D0D base, #181818 cards, #2A2A2A borders, same orange.
Small orange text on white uses a deeper orange (#CC4400) for readable contrast.
NOTE: these two files were already updated in the working copy when this pass started; this pass built on them.

## Components (class names / colours only)
- Sidebar.jsx        : uses the themed `sidebar-surface`; active chat + nav item = orange tint, ring and icon
- DomainSelector.jsx : selected mode = solid orange pill with white icon (Finance no longer green)
- DashboardPage.jsx  : chart palette now orange-forward (bars orange, malicious line orange, total line near-black),
                       active tab orange, card hover = orange border, legend text uses the normal text colour
- ChatMessage.jsx    : small orange GuardrailX indicator above AI replies; Finance badges orange instead of green
- ChatPage.jsx       : Finance banner orange; input focus = orange border + soft ring

## Optional black sidebar
Set `data-sidebar="dark"` on <html> in frontend/index.html (default is "light").

## Kept as-is on purpose
Risk/status colours (red = blocked/malicious, green = safe/allowed, amber = warn) so alerts stay recognisable.
