# Planet: a seeded hex 4X prototype

Open `index.html` by double-clicking it, or serve it from any static file server. There is no build step, no npm and no network access. Twelve plain scripts load in order: `mapgen.js`, `game.js`, `civ.js`, `tech.js`, `vision.js`, `diplomacy.js`, `ai.js`, `save.js`, `techtree.js`, `creator.js`, `panels.js` and `app.js`.

## Files

- **`mapgen.js`**: the map generator. `generate(seed, size)` returns `{ tiles, seed, size, cols, rows }`, where each tile is `{ q, r, biome, elevation, river, riverDir, resource }`. It is deterministic per seed and size (see *Map size*). A later galaxy generator can return the same shape.
- **`game.js`**: rules and state, with no DOM. A game has `civs[]`, and every city and unit has an `owner`. Each civ keeps its own design, gold, science, techs, explored tiles and hooks; `civs[0]` is the player, and `game.gold` / `science` / `tech` / `revealed` are aliases for it. `newGame(world, { civs: [{ design, modifiers, cityNames, ai }], world: [...] })` places every civ's start with `chooseStarts` (see *Start placement*). `endTurn` resolves each civ through the same `endCivTurn`, then runs world hooks (diplomacy).
  - Traits and techs are never hard-coded. `setup.modifiers` is a list of hook objects (or `function(game)` returning one), composed per hook (`HOOK_KIND`):
    - chained: `tileYield`, `buildCost`, `unitMoves`, `growthNeed`, `cityYield`, `moveCost`, `siteScore` (`moveCost` gets `info.from`, the tile the unit comes from)
    - summed: `cityScience` (on top of the base 1 science per city)
    - concatenated: `startUnits`
    - all must agree: `canBuild`, `resourceVisible`
    - called in turn: `init(game)`, `onEndTurn(game, events, science, cid)`
  - `NO_MODS` is the identity version. `exportState` / `importState` give the plain-JSON state used by saves.
- **`civ.js`**: the civilization definition and everything about it:
  - the palette, emblems (canvas glyphs) and the 8 traits, each with its hooks
  - start preferences and the default civ (Asteria)
  - the syllable name generator, `normalize` / `validate`
  - `makeModifiers(civ)`, which turns the chosen traits into the hook object
  - To add a trait, add an entry to `TRAITS` with the hooks it needs.
- **`vision.js`**: what a civ sees now (units' sight, cities' area + 1) and its memory of foreign cities and borders last seen.
- **`diplomacy.js`**: contact, attitude, open borders and war, plus the procedural greeting. It plugs in through a per-civ `moveCost` hook (foreign territory is closed without open borders or war) and a world `onEndTurn` (contacts, attitude drift).
- **`combat.js`**: unit and city combat, with no DOM. It holds strength, modifiers, the seeded damage roll, the preview, capture, raze and elimination. Healing and fortify plug in through the per-civ `onEndTurn` hook. It leaves `game.fx` records (not saved) for the renderer's animations.
- **`naval.js`**: ships, with no DOM. It registers the Trireme and Caravel, and its per-civ hooks (`moveCost`, `canBuild`, `onMove`) handle sailing, ports, boarding and disembarking. It also has `board` / `unload` and the naval AI (exploration, settler ferries). Cargo follows its ship and sinks with it through `placeUnit` / `removeUnit` in `game.js`.
- **`ranged.js`**: ranged combat, with no DOM. It registers the Archer, Catapult and Composite Bowman, line of sight, ranged attacks (also used by ships bombarding land) and the city strike. `combat.js` hands ranged attacks to it through `Combat.setRanged`, so `canAttack` / `preview` / `attack` work the same for every caller. A per-civ `moveCost` hook makes rough terrain cost Catapults 1 more.
- **`happiness.js`**: civ-wide happiness, with no DOM. It registers the Temple and Colosseum; its per-civ hooks (`growthNeed`, `cityYield`, `canBuild`, `onEndTurn`) apply the unhappy penalties and unrest.
- **`roads.js`**: Workers, roads, farms and mines, paused job progress, the capital connection (trade gold) and the AI's road planner (A*), with no DOM. Its hooks are `moveCost` (roads), `tileYield` (farms, mines), `cityYield` (trade gold), `onMove` (moving off the tile cancels the job) and `onEndTurn` (work progress).
- **`trade.js`**: Caravans and trade routes, with no DOM. Its hooks are `cityYield` (route gold, food or production at both ends), `cityScience` (+1 per foreign route) and `onEndTurn` (route timers, war and lost-city cancellation). It also holds the caravan AI. `diplomacy.js` asks it to cancel routes when war is declared, and adds foreign routes to the attitude target.
- **`deals.js`**: trade deals, ongoing deal items (gold per turn, luxury access), AI offers, demands and calls for help, with no DOM. It is a world hook (`onEndTurn` runs payments, expiries and lapsed proposals); `ai.js` calls `aiTurn` once per civ per turn, and `happiness.js` asks it for luxuries traded in or away.
- **`dealui.js`**: the deal screen (DOM only).
- **`wonders.js`**: world wonders, the Barracks, Harbor, Forge, Aqueduct and Amphitheater, the pop cap and veterans, with no DOM. Its hooks are `canBuild` (one of each wonder per world, one city per civ, coastal-only builds), `buildCost` (Pyramids), `unitMoves` (Great Lighthouse), `growthNeed` (pop cap), `cityYield` (Harbor, Forge, Hanging Gardens, Colossus) and `onEndTurn` (completions, production converted to gold for those who lose a race, veterans, Great Library). It adds Stonehenge and the Temple of Artemis to the happiness breakdown through `PlanetHappiness.addSource`.
- **`economy.js`**: what gold buys (the current build, tiles), unit upkeep (a per-civ `onEndTurn` hook that disbands a unit when gold goes negative) and unit upgrades.
- **`ai.js`**: the rival AI. It uses the same rule calls as the player (`setResearch`, `setBuild`, `moveUnit`, `foundCity`). In peacetime, every city wants 1 melee garrison, and border or coastal cities 1 ranged as well (border: a foreign city within 10 or foreign land within 4). A threat adds 1 melee (and 1 ranged at the border): a met rival with a bigger army and a city within 12, or attitude −3 or worse. Missing garrisons raise the matching unit's build score, and explorers fill empty slots every 8 turns.
- **`panels.js`**: the first-contact card, diplomacy panel and event feed (DOM).
- **`tech.js`**: the technology tree (rules only). It owns `game.tech = { done, current, progress, queue }`, registers the new units and buildings into `PlanetGame.UNIT_TYPES` / `BUILDS` with a `tech` gate, and applies effects through the hooks.
- **`save.js`**: saving. See *Saving* below.
- **`techtree.js`**: the tech tree overlay (DOM only).
- **`creator.js`**: the full-screen civ creator UI and the welcome-back card.
- **`strategic.js`**, **`air.js`**, **`promo.js`**, **`orders.js`**, **`navalai.js`** (slice 15, pass A) and **`gov.js`**, **`religion.js`** (pass B): rules only, no DOM. Each registers itself with `PlanetGame.registerPlugin({ mods, world })`, so every setup (app, saves, tests) picks it up just by loading the file. Combat bonuses go through `PlanetCombat.addStrengthMod`, deal items through `PlanetDeals.addItemType`, attitude through `PlanetDiplomacy.addReason`.
- **`pillage.js`** (slice 16): pillage, repair and plunder rules; **`aitune.js`** (slice 16): AI build adjusters, fighter patrols, strategic compliance and overseas ambition. Both rules only.
- **`ui15.js`**: the Government panel, Faith & Ideology panel, unit panel extras (XP, promotion picker, orders, air missions, missionaries), star pips, goto path preview, plane flyover and the strategic resources tooltip (DOM only; app.js calls it).
- **`app.js`**: drawing, input and HUD. Civ colours drive the territory fill, borders, city badges, unit tokens and buttons.

## Founding a civ

The creator opens before the game. You choose:

- a name, people and adjective (these two auto-derive from the name until you edit them)
- a leader title and name
- primary and secondary colours (10 swatches or a custom picker)
- one of 8 emblems
- exactly 2 traits (picking a third replaces the oldest)
- a homeland preference
- the planet seed
- the city name list (used in order)

A live preview card updates as you go. Randomize rolls a whole civ. Save design and the load menu keep designs in `localStorage` under `civPlanet.designs`. The last civ you started is remembered (`civPlanet.last`), so a reload offers **Continue with \<civ\>**, **Edit civ** or **New civ**. In game, the civ chip at the top left opens a read-only summary.

| Trait | Effect |
|---|---|
| Agrarian | +1 food on grassland and plains |
| Industrious | +1 production on hills |
| Seafaring | +1 food on coast tiles |
| Expansionist | Settler costs 20 instead of 30 |
| Militaristic | Warrior costs 6; start with a Warrior |
| Mercantile | +1 gold on river tiles |
| Nomadic | +1 movement for all units |
| Scholarly | +2 science per city each turn (shown in the top bar) |

The homeland preference (anywhere, temperate, coastal, river or hills) adds a bonus to start-site scoring. It nudges the choice but does not guarantee it.

## Start placement

`chooseStarts` places every civ at once:
- **Landmasses:** connected land is labelled first.
- **Player:** gets the best site by its own start preference, on a landmass of 60+ tiles.
- **Fairness:** a rival only considers sites whose raw quality (site yields, no preference) is at least 78% of the player's. It falls back to 65% or 50% if nothing qualifies. Sites below 92% of the player's quality are penalised.
- **Spread:** each rival takes the candidate that maximizes its minimum distance to the starts already chosen (capped at 40). An unused landmass is worth +40 when there are enough landmasses with good sites for the civs still to place, +8 otherwise. The civ's own preference breaks near-ties.

`game.startInfo` keeps each start's quality and landmass. Results with 2 rivals:

| Seed | Start quality (player/r1/r2) | Landmass (size) | Pairwise distance |
|---|---|---|---|
| marco | 129 / 108 / 103 | 569 / 294 / 253, all different | 57, 39, 28 |
| ember42 | 146 / 118 / 123 | 1040 / 273 / 1040 | 57, 17, 68 |
| zz9 | 147 / 129 / 119 | 368 / 1072 / 1072 | 41, 28, 26 |
| q1 | 136 / 128 / 135 | 958 / 357 / 958 | 72, 20, 55 |
| atlas | 143 / 118 / 115 | 926 / 160 / 250, all different | 68, 56, 32 |

With 4 rivals the minimum distance drops to 10 to 14 hexes.

## Rivals

New games have 2 AI civilizations by default; set 1 to 4 under *Rival civilizations* in the creator, or with `?rivals=N`. Each rival comes from the random civ generator, seeded by the planet seed, and gets a primary colour no other civ uses. That gives each one its own name, leader, colours, emblem, two traits and city names.

The AI is simple but real:
- **Research:** picks the available tech with the best (1 + trait bonus) / cost. For example, Scholarly favours Writing and Philosophy, and Militaristic favours Bronze and Iron Working.
- **Builds:** weighted priorities. It builds a settler while it has fewer than 5 cities and pop ≥ 2, warriors until it has a garrison and an explorer per city, then buildings weighted by trait (Granary for Agrarian, Library for Scholarly, Market for Mercantile, and so on). With nothing worth building, a city goes idle and banks production, up to 30.
- **Settlers:** pick a site 3 to 7 hexes from home by site score minus distance (+15 for a port site while the civ has no coastal city), travel there with a whole-map path, and found. With no reachable land site left, a settler waits at the nearest port for a ferry (see Ships).
- **Ships:** with Sailing and a port, it builds one Trireme to explore, and a Caravel once it has Navigation. Ships explore by a breadth-first search over water they can sail, toward the nearest water next to unexplored tiles. When a settler is waiting, an idle ship picks the best revealed site on another landmass (within 40 hexes, next to water it can sail, reachable by sea). It gathers the settler plus the nearest free military unit as escort at the port, sails, and lands them next to the site. The settler then founds normally. Failed sites are remembered and skipped. At war, an empty ship attacks when the preview favours it.
- **Warriors:** one garrisons each city; the rest explore the nearest frontier, meaning explored tiles next to unexplored ones.
- **War:** with no war on, an AI declares war on a met civ when all of these hold: turn 30+, at least 3 military units, power at least 1.5× theirs + 3, attitude Wary or worse (Neutral or worse if Militaristic), and a city within 18 hexes. Power is the sum of unit strength × HP plus 2 per city. At war:
  - Units attack adjacent targets when the preview looks worth it. Garrisons only take clearly good fights.
  - The rest march on the enemy city with the best mix of nearness and low defense.
  - Units below 40 HP fall back to a city within 5 hexes, else hold still to heal.
  - Builds favour military and Walls, and gold buys units.
  - When its power falls below 60% of the enemy's after 6+ turns, it sues for peace. Another AI accepts if it is not clearly winning. You get an offer to accept in the diplomacy panel.
- **Plans:** each unit's plan (role, target) is stored on the unit, so it survives saving. All choices use seeded hashes, so a loaded game plays on exactly as it would have.

**Fog:** you see rival units only while they are in sight. Explored tiles out of sight are dimmed and show the last seen borders, cities (size and HP), and rival units, drawn faded where they were last seen. A remembered unit is forgotten once that tile is back in sight.

## Diplomacy

- **First contact:** when one of your units or cities first sees a rival unit or city, a first-contact card shows their emblem, name, leader, traits and a greeting assembled from their traits. The tone of its last line depends on their attitude.
- **Diplomacy panel** (**D** or the Diplomacy button): lists the civs you've met with Peace or War, an attitude word with a slider, and what drives it.
  - Attitude runs from -10 to 10: Hostile, Wary, Neutral, Friendly, Cordial.
  - Each turn it moves one step toward a target: +2 per shared trait, -2 per clashing pair (Militaristic with Mercantile or Scholarly, Agrarian with Nomadic, Expansionist with Seafaring, Industrious with Nomadic), -1 per pair of cities within 8 hexes (up to -3), +1 with open borders, and -6 at war.
- **Reasons:** the target is the sum of the reasons listed under each civ in the panel: shared or clashing ways, border tension, open borders, trade routes, war (−6), a shared enemy (+2), pacts (Allies +2, Defensive pact +1, Non-aggression +1, Research +1), and remembered events. Memories fade by 0.1 a turn, so a +4 gift is gone after 40 turns. Good memories stack to +3 or +4; bad ones go to −8:
  - Trades with us (+1.5 per deal), Gave us gifts (+1 to +5 by value), Paid us tribute (+1), Joined our war or Honoured our pact (+3)
  - Refused our demand (−3), Stopped paying what was promised (−4), Refused to help in a war (−1), Abandoned us when attacked (−5), Broke a pact with us (−8), Broke a pact with someone else (−3, with everyone who has met the breaker)
- **Known relations:** a grid at the bottom of the panel shows how the civs you have met get along with each other (word, war, alliance, pact, NAP, research agreement, open borders), or "·" if they haven't met.
- **Trade… (the deal screen):** each side has an **Add…** menu: gold as a lump sum, gold per turn for 20 turns, techs they lack, luxury access for 30 turns, your world map (with the number of new tiles), and cities other than the capital. **Agreements** below apply to both sides. The reaction updates live as you edit: **Acceptable**, **They want more** (about how much) or **Refuse** (with the reason). **What would they want?** shows their counter-proposal (they add gold, a tech or gold per turn from your side, or drop something of theirs). **Propose deal** is enabled when it's acceptable.
- **How the AI values a deal:** net = what it gets − what it gives + agreement values. Gold counts 1:1, gold per turn 0.75 per gold, a tech 2 × its cost (giving one away costs 0.7 ×, more if you are stronger or disliked), luxury access 80 if they lack it (giving away their only copy costs 100), a map 15 + 0.15 per new tile, a city 40 per pop + 80. They accept when net ≥ 15 − 5 × attitude, 15 less if you are more than twice as strong. Traits weight items: Mercantile gold, Scholarly techs, Expansionist cities, Seafaring maps, Agrarian luxuries, Militaristic alliances (and they like NAPs less when they could win a war). A gift with nothing asked is always accepted. They never trade a city below Cordial.
- **Agreements:** Non-aggression pact (20 turns; needs better than Hostile), Defensive pact (needs Friendly), Alliance (needs Cordial; a defensive pact plus shared vision and open borders), Research agreement (needs attitude 1+; both pay 60 gold; when it ends after 20 turns each side gets 60% of its cheapest unresearched tech's cost in science). An alliance ends below attitude 2 and a defensive pact below 0.
- **Calls to arms:** when a civ is attacked, its AI partners with a defensive pact or alliance declare war on the attacker at once. If you are the partner, you are asked (**Join the war** or **Stay out**; staying out or not answering in 3 turns ends the pact with −5). Declaring war on a pact partner breaks the pact (see the memories above). The AI keeps a NAP or pact unless attitude is −6 or worse and it is 2.5 × stronger, and counts the target's allies when it weighs a war.
- **AI offers and demands** (one move per partner on about a quarter of turns): a civ more than twice as strong and not Friendly demands tribute every 25 turns at most (gold or a tech). Refusing is remembered, and a civ 3 × as strong (or 2.2 × if Militaristic) declares war. It asks friends to join its wars, proposes pacts by attitude, swaps, sells or buys techs, and sells spare luxuries. It only proposes what it would accept itself. Proposals to you appear at the top of the diplomacy panel (**Accept**, **Counter…**, **Decline**, **Pay** or **Refuse**) with a count on the Diplomacy button; they lapse after 2 turns, and a lapsed demand counts as refused. AIs deal with each other the same way.
- **Open borders** is mutual. They refuse while Wary or worse, and close their borders if attitude drops to -4.
- **Declare war** (asks for confirmation) sets war, drops attitude by 8, closes borders and posts a notice. At war your units can enter their territory and attack. After 5 turns you can propose peace; an AI refuses while it is clearly winning. An AI's peace offer shows as **Accept peace offer**.
- **Territory:** each civ's territory is drawn in its colours. You can't found a city inside another civ's territory, or enter it without open borders or war.

**Event feed:** the collapsible panel at the bottom left shows your last 7 events (growth, built, tech, contact, war, diplomacy). The log is kept in the save.

## Combat

| Unit | Strength | Moves | Notes |
|---|---|---|---|
| Warrior | 6 | 1 | |
| Spearman | 10 | 1 | +50% vs Horseman (attacking or defending) |
| Horseman | 10 | 2 | |
| Swordsman | 14 | 1 | |
| Settler | — | 2 | cannot fight; captured if attacked |

- **Attacking:** select a unit; adjacent enemies you are at war with get a red outline. Hover one to see the **combat preview**: both effective strengths, every modifier, expected damage each way, and the verdict. Click to attack.
  - An attack uses all of the unit's moves.
  - If the defender dies and the tile is clear (and not a city), the attacker moves in.
- **Resolution:** effective strength = base × (1 + modifiers) × (0.5 + 0.5 × HP/100).
  - Damage to the defender is 30 × ratio^0.9 × roll; damage to the attacker is 30 / ratio^0.9 × roll.
  - The roll is 0.75 to 1.25, from a hash of seed, a combat counter and the two ids, so fights are deterministic per seed and replay identically after a load.
- **Modifiers:**
  - Defender: hills, forest or jungle +25%; fortified +25%; in its own city +25%.
  - Attacker: −25% attacking onto a river tile (the river-crossing approximation).
  - Wounded units are weaker via the HP factor.
- **Fortify:** **F** or the Fortify button: the unit skips its turn and is fortified from the next turn. Any military unit that doesn't move for a turn also fortifies. Moving or attacking ends it. Fortified units show a small shield and are skipped when the next unit is auto-selected.
- **Healing:** +10 HP per turn, +20 in a friendly city. Nothing on a turn the unit fought (otherwise wars stalemate). Cities regain 10 HP per turn unless hit that turn.
- **Cities:** defense is 4 + 0.75 × pop, ×2 with Walls (Masonry, 30), plus half the best garrison unit's strength. Cities have 100 HP.
  - Attacking a city tile always hits the city; the garrison only adds strength.
  - At 0 HP, a melee unit that moves in captures it: the owner changes, the city loses 1 pop and drops to 50 HP, and its garrison dies. A pop-1 city is razed.
  - **Capitals:** when a capital (★ on the plate) is captured or razed, the civ moves its capital to its biggest remaining city. Ties go to higher production, then the oldest city. An event is logged (feed label *Capital*), and a notice banner and toast read "<civ> moves its capital to <city>". The capital flag is all there is: no yields depend on it, so nothing else changes.
  - **Elimination:** a civ is eliminated only when it has no cities left. Surviving settlers do **not** keep it alive; they disband with its other units, its wars end, and everyone gets a notice.
- **Animations:** the attacker lunges toward the target, the hit tiles flash, and damage numbers float up (about 1 s, then the redraw stops). Damaged units and cities show HP bars.
- **HUD:** hovering a tile with rival units lists their type, strength, HP and fortify status.

## Ships

| Ship | Tech | Cost | Strength | Moves | Water | Carries | Sight |
|---|---|---|---|---|---|---|---|
| Trireme | Sailing | 24 | 6 | 3 | coast only | 2 | 2 |
| Caravel | Navigation (Sailing + Mathematics) | 40 | 10 | 4 | coast and deep ocean | 3 | 3 |

- **Ports:** ships are built only in coastal cities, meaning next to a sea of 30+ water tiles (lakes don't count). Ships can enter their own cities; a ship entering one unloads its cargo there.
- **Boarding:** move a land unit onto a friendly ship with room in an adjacent water tile. In a port, a land unit on the same tile as a docked ship gets a **Board** button. Either way, boarding ends the unit's move.
- **Disembarking:** move a carried unit onto adjacent land, or select the ship and press **Unload** (**U**). Every carried unit with moves left goes ashore. Landing ends the unit's move.
- **Carrying:** carried units move with the ship, are drawn as small lettered badges under it (not as separate tokens), and die if it sinks. The ship's unit panel lists them (*Aboard 2/2: Warrior, Warrior*).
- **Seafaring trait:** land units can still step onto coast on their own once Sailing is known, and ships get +1 move.
- **Naval combat** uses `combat.js`:
  - Ship against ship works like units on land.
  - Ships can attack (bombard) adjacent coastal land units and cities. They never advance onto land and cannot capture cities or settlers.
  - Land units cannot attack ships at sea, and carried units are never targets.
  - A Trireme cannot attack into deep ocean.
- **Pathfinding:** ships use the same reach and path code. The `moveCost` hook gives water a cost of 1 for ships and makes land impassable to them (except their own cities). Closed borders apply at sea too.

## Map size

The creator has **Map size** (Small, Standard, Large, Huge) next to **Rival civilizations**, both remembered in `localStorage`. `?size=small|standard|large|huge` overrides it.

| Size | Grid | Tiles | Rivals |
|---|---|---|---|
| Small | 48 × 32 | 1,536 | 1–4 |
| Standard | 72 × 50 | 3,600 | 1–4 |
| Large | 100 × 64 | 6,400 | 1–6 |
| Huge | 128 × 84 | 10,752 | 1–6 |

Standard is the original grid with the original noise, so old seeds and saves give the same planet. On other sizes the noise is sampled at `(72 / cols)^0.6` of its frequency, so bigger maps get partly bigger continents and partly more of them. Sea level is a percentile, so land stays at 43% on every size. The cap on river systems scales with area (20 on Standard); resource chances are per tile, so their density stays the same. Measured on seeds marco, q1 and ember42: landmasses of 8+ tiles number 3–4 on Small, 3–8 on Standard, 2–6 on Large and 2–8 on Huge; rivers cover 1–8% of land; resources are 5–7 per 100 land tiles. Generation takes about 0.1 s on Small and 0.75 s on Huge.

The size is saved (`data.size`, `game.size`) and is part of the map fingerprint (left out for Standard, so old hashes still match).

**Rendering:** hexes outside the view are culled. When zoomed out, static terrain and rivers come from an offscreen canvas built once per map (at most 4096 px a side). Territory and fog come from half-resolution layers that are rebuilt only when vision, ownership or the turn changes. Zoomed in, crisp per-hex drawing takes over.

## Ranged combat

| Unit | Tech | Cost | Ranged | Defense | Range | Moves | Notes |
|---|---|---|---|---|---|---|---|
| Archer | Archery | 14 | 6 | 4 | 2 | 1 | |
| Catapult | Mathematics | 30 | 12 | 4 | 2 | 2 | +50% vs cities · hills, forest and jungle cost 1 more move |
| Composite Bowman | Construction | 26 | 10 | 7 | 2 | 1 | |

- **Attack:** a ranged unit hits any enemy within its range that it can see. It takes no retaliation, stays where it is, and uses all its moves. Damage uses the same formula as melee, against the target's melee defense (terrain, fortify, in-city) or the city's defense.
- **Line of sight:** adjacent tiles are always in sight. At range 2, a mountain on the line always blocks; hills, forest and jungle block unless the shooter stands on hills. The line runs through hex centres; when it passes exactly between two hexes, either side being clear is enough.
- **Limits:** a ranged attack can bring a city to 0 HP but never takes it; a melee unit must move in. Land units can't shoot ships at sea.
- **Ships** bombarding a land tile use the same path (range 1, their strength). Ship against ship is still melee.
- **City strike (my call):** a city with **Walls**, or any capital (its city-centre bonus), may shoot once per turn at an enemy unit within 2. Its strength is 60% of its current defense. In the city panel, **City strike (N targets)** highlights the targets; click one, or press Esc.
- **Preview:** hover a target for the same tooltip as melee, headed *Ranged attack · range N*, showing *No retaliation*. City strikes preview the same way.
- **AI:** bestAttack scans every tile in range. At war, ranged units hold when an enemy is within 2, and otherwise move to a tile 2 hexes from the target city with a clear shot. Builds aim for about one ranged unit per two melee. Every AI city with a strike shoots its best target each turn (kills first).

## Happiness

`happiness = 4 base + 2 palace (you hold a capital) + luxuries + buildings − 2 per city − floor((pop − 2) / 2) per city`

- **Luxuries** (Gems, Spices, Gold): **+3** for the first copy of each type in your territory, and **+1** for each extra copy on the land of a city connected to the capital (see *Workers, roads and trade*).
- **Buildings:** Temple +2 (30, **Ceremonial Burial**), Monument +1 (Masonry), Colosseum +3 (50, **Construction**), per building.
- **Unhappy (below 0):** growth needs 1 / 0.75 of the food (−25% growth), and every city makes 1 less production.
- **Very unhappy (below −5):** no growth (food stops piling up), no Settlers, and each city has a 15% chance per turn (+3% per point below −5, at most 40%) of unrest. A city in unrest produces no production or gold next turn, with an event and a red line in its panel. The roll is a seeded hash, so it's deterministic.
- **Top bar:** a face (green content, amber unhappy, red very unhappy) and the number. Hover it for the breakdown, one line per term, for example "Cities (5 × −2) −10" and "Population (1 per 2 pop above 2, per city) −15".
- **Founding:** the Settler's panel shows the change next to **Found city**: −2 for the city, plus +3 for any new luxury type in its first ring, and the total after.
- **AI:** it trains a Settler only if it would stay at −1 or better afterwards. It builds Temples and Colosseums only at +2 or below, sooner the lower it is, and counts the amenities its other cities are already building (otherwise every city starts a Colosseum on the same turn).
- **Tuning (v2, slice 10):** v1 was +2 per luxury, no palace, −1 per city and −floor(pop / 2) per city. In autoplay that kept most civs at −1 to −3 for the first 50 turns (stalling settlers), and let built-up AIs climb to +11 to +20 by turn 100. With v2, five-city empires sit at about −1 to +5 at turns 75 to 100 across 3 seeds on Standard and Large, while 8 cities at pop 6 with no amenities sit at −26. A Market +1 with a luxury was tried and dropped; it pushed built-up empires too high.

## Workers, roads and trade

- **Worker** (18, 2 moves, available from the start; my call). It can't fight and is captured like a Settler. Its jobs, on its own tile, are buttons in the unit panel:
  - **Road:** 2 turns (3 in hills, forest and jungle).
  - **Farm:** +1 food on plains, grassland, desert or tundra in your territory, 3 turns.
  - **Mine:** +1 production on hills in your territory, 3 turns.
- Work advances at the end of each turn the Worker stays on the tile. Working doesn't use moves.
- **Cancel:** **Cancel job** in the unit panel (or **X** / **Backspace**) stops it, and the Worker keeps the moves it has left. Moving a working Worker cancels the job too, with a toast. **Progress is kept on the tile** (`game.jobs`): starting the same job there again shows **Resume road · 1 of 2t left** and continues. A finished job clears its progress. The AI cancels when an enemy unit at war is within 2 tiles and runs home.
- **Roads:** moving between two road tiles costs 1/3 of a move. Cities count as road tiles. Roads are thin tan lines between neighbouring road tiles; farms are hatched lines and mines a small peak mark.
- **Capital connection:** a city linked to its capital by a chain of road tiles, or by a harbor link, earns **+max(1, floor(pop / 2)) gold**. A harbor link needs Sailing and both cities being ports on the same sea. Connected cities show a gold link badge on their plate, and the city panel's **Trade** row says how they connect and what they earn.
- **AI roads:** keeps about one Worker per two cities. It plans its roads with `roadPlan`: the A* shortest road path from each city to the capital, where road tiles cost 1/3, other tiles their terrain cost, and water, mountains and other civs' land are excluded. The plan follows existing roads, and Workers only build on planned tiles that have no road yet (the nearest first, skipping one another's). With nothing left to build, they farm or mine worked tiles. Over 100 turns of autoplay (2 seeds × Standard and Large), every non-capital city ended up road-connected (before: 6/9 and 11/12 on Standard). That took 21 to 50 road tiles, none off the plan.

## Caravans and trade routes

- **Caravan** (30, **Currency**, 3 moves): it can't fight and is captured like a Settler. It remembers the city that built it (`unit.home`).
- Move it next to (or into) another of your cities, or a city of a civ you've met and are at peace with. The unit panel then shows **Trade with …** buttons with the yields. For a domestic route, you pick what the destination gets: gold, food or production. The Caravan is consumed and the route runs for **30 turns**. A new Caravan on the same pair **renews** it.
- **Yield per turn:** `base = 1 + min(distance, 15) / 7.5 + (pop of both cities) / 10`, × 1.5 for a foreign route. The home city gets round(base) gold, and the destination round(base × 0.6), as gold, food or production. Foreign routes also give **+1 science** in both cities and **+1 to the attitude target** of the two civs (at most +2).
- **Route slots** per home city: 1, +1 with a Market, +1 per 8 pop. The Trade panel lists them.
- **War** cancels routes between the two civs (at once when declared, and at the end of every turn as a check). A lost or razed city drops its routes. There is no plunder.
- **Map:** routes are faint dashed curves between the two cities, blue for domestic and tan for foreign, shown only when both cities are known.
- **Trade panel** (**R** or the **Trade** button): your routes with their yields and turns left (amber at 5 or fewer), routes into your cities, total route income, and route slots per city.
- Route gold shows in the gold tooltip ("incl. trade routes +N"), and the turn summary has a line with route income. New, renewed, expired and cancelled routes go to the feed.
- **AI:** with Currency, two or more cities and a free route slot, it keeps one Caravan around. Each Caravan goes to the best target by yield and distance (within 24 tiles), its own cities included. Foreign cities qualify only at peace with attitude 0 or better, the player included. Domestic routes go to food when the destination is small, otherwise production.

## Gold

- **Buy:** the city panel's **Buy … · N gold** button finishes the current build at the end of the turn. It costs 2.5 × the remaining production, minimum 5.
- **Upkeep:** 1 gold per unit beyond 2 per city, taken at the end of the turn. The top bar shows net gold per turn, with income and upkeep in its tooltip. If gold goes negative, the weakest unit (settlers last) is disbanded with a notice and gold resets to 0.
- **Upgrade:** a Warrior can become a Swordsman (Iron Working) or Spearman (Bronze Working), and an Archer a Composite Bowman (Construction). The **Upgrade to …** button in the unit panel needs the unit inside your territory. It costs 2 gold per production point of difference (at least 10) and uses the unit's moves. The AI upgrades one garrison a turn when it can keep a 40-gold reserve.
- **Wonders** can be bought at double the rate (5 gold per remaining production). Other things the gold buys now: techs, luxuries, pacts and goodwill in deals (see Diplomacy). The AI keeps a reserve of 50 + 12 per city, rushes buildings above it, rushes a wonder above 3 × the reserve, buys a tile when it has 220 more than the reserve, and sends gifts (up to 120 gold) to neighbours it isn't close to when it has 400+.
- **Buy a tile:** **Buy a tile…** in the city panel highlights the tiles you can buy, with prices. These are unowned tiles within 3 of the city that touch its territory. A tile costs 8 × distance + 1 per tile the city already owns (about 40 to 50 for a radius-3 tile). Bought tiles beyond the city's normal radius can be worked too. **Esc** stops.

## Buildings and wonders

- **New buildings:** Barracks (Bronze Working, 35): land units trained there are veterans (+20% strength in attack and defense, shown as a combat modifier). Harbor (Sailing, 45, coastal): +1 food per worked water tile and +1 trade route slot. Forge (Iron Working, 50): +15% production (at least +1). Aqueduct (Engineering, 60): pop cap 16. Amphitheater (Literature, 45): +2 happiness.
- **New techs:** Mysticism (after Ceremonial Burial), Literature (after Philosophy) and Engineering (after Construction). The tree now has 20 techs.
- **Pop cap:** a city stops growing at 8 pop, at 12 with fresh water (a river on or next to the city tile), and at 16 with an Aqueduct. Food keeps piling up to the growth threshold. The city panel says why it isn't growing. Cities already bigger (old saves) don't shrink.
- **Wonders** (one per world; a civ builds each in one city at a time; they can't start once someone has finished it). When a civ completes one, every other city building it turns its stored production into gold, with a notice for you.

| Wonder | Tech | Cost | Effect |
|---|---|---|---|
| Pyramids | Masonry | 140 | Buildings cost 25% less in all your cities |
| Stonehenge | Mysticism | 110 | +1 happiness per city |
| Oracle | Mysticism | 130 | Your current research completes at once (or the priciest available tech) |
| Colossus | Bronze Working | 130 | +1 gold per worked water tile in its city (coastal) |
| Great Lighthouse | Sailing | 120 | +1 move for your ships (coastal) |
| Hanging Gardens | Mathematics | 150 | +1 food in every city |
| Temple of Artemis | Philosophy | 160 | Each Temple gives +2 more happiness |
| Great Library | Literature | 190 | Each turn, a tech known by 2 civs you've met |
| Terracotta Army | Engineering | 180 | A free veteran melee unit (best of Swordsman, Spearman, Warrior) in every city |

- **Seeing them:** a gold temple marker sits beside a city with wonders (with a count if more than one). **W** or the Wonders button opens the Wonders panel: every wonder, its effect, who built it, where and when, your progress, and rivals you know are building it. Completing one shows a card with a short flavour line.
- **AI:** only its largest city builds wonders, one at a time, from turn 15 and with 2+ cities. The score is 3.2, +1.5 if Industrious, +2 for wonders that suit a trait (Scholarly: Great Library and Oracle, Seafaring: Colossus and Great Lighthouse, and so on), −0.9 per wonder it already owns, and −2 if a known rival is more than 60% done. It doesn't build wonders at war, and it can lose the race.

## Saving

- **Slots:** slot 0 is the **autosave** (`civPlanet.save`, the same key as before, so old saves appear there), written when a game starts and at the end of every turn. Slots 1–5 are named manual saves (`civPlanet.slot.N`).
- **Save** opens the Save panel: type a name and press **Save here** or **Overwrite**.
- **Load game…** on the welcome card opens the Load panel. It lists each save with civ emblem, name, civ, turn, year, map size, city count and date, and offers **Load** and **Delete** (Delete asks first).
- **Continue** loads the most recently saved slot. Export and import work from the welcome card and from the panel's footer.
- A save is `{ version, savedAt, slot, name, seed, size, mapHash, civ, camera, game }`. The `game` part holds the turn, every civ (design, AI flag, gold, science, techs, explored tiles, memory of what it has seen, city names), all cities and units with owners, builds, repeat flags and AI plans, territory, diplomacy and the event log. There is no RNG state: generation, starts and AI choices are seeded hashes and the rules are deterministic.
- The map is never stored. Loading regenerates it from the seed and compares an FNV hash of the tiles; if they differ, a warning toast says the map may have changed.
- `version` is 12 (slice 16 adds `game.pillage` and `game.aitune`; see the slice 15 and 16 sections for v8–v12). New in v7: `game.deals` (running deal items, pending proposals, AI timers and stats), `game.wonders`, and in `game.diplo` the attitude memories (`mem`), pacts (`pact`) and the player's open calls to arms (`asks`), plus `unit.vet`. New in v6: `game.trade` (routes and their turns left), `game.jobs` (Worker progress kept on tiles) and `unit.home` (the city that built a unit). New in v5: map size, `game.roads`, `game.improvements`, Worker jobs (`unit.work`), city `unrest` and `struck` (the turn of its last city strike). Happiness isn't stored; it is recomputed from the state.
- From v4: Ship state is saved on units: `aboard` (the carrying ship's id) and the AI's ferry `mission`, `ferry` and `role` fields. Combat state is saved too: unit HP, fortified, fortifying and moved flags, city HP and capital flags, eliminated civs, the combat counter (`combatSeq`), peace offers, and remembered rival units.
- `PlanetSave.migrate` upgrades step by step:
  - v1 → v2: the single civ becomes `civs[0]`, everything gets owner 0, and cities keep repeating their build.
  - v2 → v3: everything at full HP, nobody fortified, each civ's earliest city is its capital, and the combat counter starts at 0.
  - v3 → v4: nobody is aboard a ship, and any surviving civ with cities but no capital gets one (its biggest city). Civs eliminated under the old capital rule stay eliminated, and their transferred cities stay with the conqueror.
  - v4 → v5: the map is Standard (the only size before), there are no roads or improvements, no unrest and no city strike used yet, and the save goes into the autosave slot.
  - v5 → v6: no trade routes, no paused jobs, units without a home city (a Caravan without one trades from your nearest city), and a job in progress keeps its turns left as its total.
  - v6 → v7: no deals, proposals, memories, pacts or wonders yet, and no existing unit is a veteran.
  - The starts in a migrated game stay where they were. A v1, v2, v3 and v4 save have each been migrated to v5 and played on (see the slice report), and the v4 save to v6 as well.
- Saves from newer versions are rejected.
- On reload, the welcome card shows the saved civ with its turn, year, cities and units:
  - **Continue** resumes the exact game, camera included.
  - **New game** starts fresh with the same civ.
  - **Edit civ** and **New civ** first ask, because they start a new game. The old save is kept until the new game begins.
- **Export save / Import save…** on the welcome card (and **Export save file** in the Civ summary) download or load the save as JSON.

## Technologies

Science per city is 1, plus 1 per 3 pop, plus Scholarly (+2), Library (+2) and Philosophy (+1). Tech costs are 15 / 28 / 42 / 60 / 85 by column, which works out to about one tech every 6 to 10 turns early with one or two cities. It flows into the current research each turn, and leftover points carry over. The top bar shows the current tech, progress and turns left; it pulses when nothing is being researched, and the end-of-turn toast reminds you. Press **T** or click the research button to open the tree. Clicking an available tech researches it; clicking a locked one queues the whole path to it.

| Tech | Needs | Cost | Effect |
|---|---|---|---|
| Agriculture | — | 15 | +1 food on Wheat |
| Ceremonial Burial | — | 15 | Temple (30): +2 happiness |
| Mining | — | 15 | +1 production on Iron and Gold |
| Archery | — | 15 | Archer (cost 14; ranged 6, defense 4, range 2) |
| Pottery | Agriculture | 28 | Granary (40): +2 food |
| Animal Husbandry | Agriculture | 28 | Reveals Horses (hidden and yield nothing before) · Horseman (cost 16; strength 10, 2 moves) |
| Bronze Working | Mining | 28 | Spearman (cost 14; strength 10, +50% vs Horseman) |
| Masonry | Mining | 28 | Monument (30): +1 production, +1 gold, +1 happiness · Walls (30): +100% city defense |
| Sailing | Pottery | 42 | +1 food on Fish · Trireme · Seafaring civs can move land units onto coast |
| Writing | Pottery | 42 | Library (55): +2 science |
| The Wheel | Animal Husbandry | 42 | Settlers +1 movement |
| Iron Working | Bronze Working | 42 | Swordsman (cost 22; strength 14) |
| Mathematics | The Wheel, Masonry | 60 | +1 production in every city · Catapult (cost 30; ranged 12, +50% vs cities) |
| Currency | Writing, Bronze Working | 60 | Market (60): +25% city gold (at least +1) |
| Philosophy | Writing, Mathematics | 85 | +1 science in every city |
| Navigation | Sailing, Mathematics | 80 | Caravel (ocean-going ship) |
| Construction | Masonry, Mathematics | 80 | Colosseum (50): +3 happiness · Composite Bowman (cost 26; ranged 10, defense 7) |

When a unit or building finishes, the city's build goes empty: the city panel asks *Choose what … builds next*, the end-of-turn toast lists the cities that need orders, and production is banked (up to 30) until you choose. Tick **Repeat unit builds** in the city panel to keep training the same unit.

## Playing

Click your Settler, then click a highlighted tile to move. Water and mountains block movement; hills, forest and jungle cost 2 moves.

Press **B** or Found city to found a city, then **Enter** or End Turn to end the turn. At war, click an outlined enemy to attack: adjacent for melee, within range for ranged units (hover first for the preview). Press **F** to fortify. Workers build from their unit panel; **X** or **Backspace** cancels a Worker's job. **R** opens the Trade panel and **W** the Wonders panel. Ships: move a unit onto your ship to board, select the ship and press **U** to unload. **T** opens the tech tree and **D** the diplomacy panel. **Esc** deselects or closes panels, and **Enter** or **Esc** dismisses a first-contact card. Map layers (rivers, resources, fog, legend), the **Turn summary** toggle and the new-map seed form are under **Map ▾**.

**Turn summary** (on by default): at the start of each turn, a compact card at the top left lists what happened since you pressed End Turn:
- battles (up to 3 kills or losses, the rest folded into one line), wars, contacts, capital moves and unrest
- techs finished, or research still needed
- builds and growth (at most 4 lines each)
- cities waiting for orders, and trade income

Click a line to centre the camera on it (the research line opens the tree). The card never blocks: Esc or a click on the map dismisses it.

The city panel shows food, production and gold, and lets you build a Warrior (10), a Settler (30; needs pop 2, costs 1 pop), and whatever your techs have unlocked.

## URL parameters

- `?seed=xyz` sets the planet.
- `?civ=default` skips the creator and plays as Asteria.
- `?autoplay=10` scripts the first steps (select, move, found a city), then plays 10 turns. Each turn your side is run by the same AI as the rivals (research, builds, settlers, explorers) before Enter ends the turn. Contact cards are closed automatically unless `&stopAtContact=1`. It uses the default civ unless a demo civ is set.
- `?shipdemo=1` (after autoplay; **staged** for screenshots): your first ship and two land units are placed in a port, the units board through the real rule, and the ship sails along the coast.
- `?capdemo=1` (after autoplay; **staged**): war on the first met rival with 2+ cities, with a Swordsman placed next to its capital at 0 HP. The capture, the capital move and the notice then run through the real rules.
- `?size=small|standard|large|huge` sets the map size. `?rivals=N` is 1 to 4, or 1 to 6 on Large and Huge.
- `?perf=1` (after autoplay): logs the average turn time, plus render times at world, play and close zoom, in `data-autoplay`.
- `?stage=ranged|happy|happy2|roads|saves|summary|workercancel|trade|airoads|deal|diplo2|wonder|wonders` (after autoplay; **staged** for screenshots). `deal` meets everyone, adds memories and pacts, and opens the deal screen with gold and your map offered for a tech (`&counter=1` shows their counter-proposal). `diplo2` opens the diplomacy panel with a tribute demand waiting. `wonder` finishes a wonder in your capital through the real end of turn and shows the card. `wonders` starts one at 40% and opens the Wonders panel. `workercancel` places a Worker one turn into a road and selects it. `trade` opens a domestic and a foreign route (meeting the nearest rival) and the Trade panel. `airoads` frames the rival with the most road tiles, with fog off. `ranged` places an Archer (or `&unit=catapult`) 2 hexes from a rival Spearman, at war, and hovers the preview. `happy` pins the happiness tooltip open. `roads` frames the capital with its connected cities. `saves` writes slots 1, 2 and 4 (slot 4 relabelled as a Huge, turn-12 save) and opens the Load panel. `summary` plays one more turn to show the card.
- Also: `?fog=0` (fog off), `?view=world` (zoom to the whole map, collapse the feed), `?panel=diplo` (open diplomacy).
- `?demo=creator` fills the creator by clicking Randomize and two trait cards.
- `?demo=play` does the same and then starts the game. Combine it with `&autoplay=6`.
- Optional extras for the demos: `&rseed=27&traits=industrious,scholarly`. Autoplay researches toward `&research=currency` by clicking that card in the tree.
- `&tree=1` opens the tech tree after loading.
- `&war=N` (after autoplay) declares war on the first rival you've met through the diplomacy panel, then lets the AI play your side for N more turns. Attacks, damage, city hits, captures and razes go to `body[data-autoplay]`.
  - `&shot=preview` stops at the first attack with modifiers, with the preview open.
  - `&shot=battle` stops just after one of your attacks near an enemy city, with the effects frozen.
- `&fortify=1` fortifies one unit and saves. `&more=N` plays N more turns, then writes the state fingerprint (used by the save test).
- `&probe=end` writes a fingerprint of the full game state to `body[data-state]`. With `?probe=continue`, the page also clicks Continue first. These are used by the headless save test.

- `?s16=pillage` / `?s16=relspread` (after `?autoplay=N`): the slice 16 screenshot scenes.

## Slice 12: Eras through the space age, and the story layer

Save format **v8** (v7 → v8 migration; v1 → v8 chain tested).

**Eras (`eras.js`).** 8 eras and 63 techs: Ancient, Classical, Medieval, Renaissance, Industrial, Modern, Information, Space. Each tech is one line of data, and the tree layout is computed from the era and prerequisites. The tech tree (T) scrolls sideways (wheel or drag), has era headers, era jump buttons and a minimap. Your civ's era comes from its most advanced techs (2 or more known in an era), and each new era shows a card. The calendar runs at 40 → 25 → 20 → 10 → 5 → 2 → 1 years per turn.
Units run from Pikeman to Modern Armor and Missile Cruiser, with Frigate, Ironclad, Destroyer, Battleship and Transport at sea. They have upgrade lines that cost gold (Leonardo's Workshop makes upgrades 75% cheaper), obsolescence and bonuses against specific units. Buildings: University, Bank, Factory, Hospital, Stock Exchange, Research Lab, Stadium and Spaceport. Advanced buildings cost gold upkeep. Late wonders: Notre Dame, Sistine Chapel, Leonardo's Workshop, Eiffel Tower, Hoover Dam, Internet and Apollo Program.
**Projects** are a build type: Grand Expedition, World's Fair, Orbital Satellite, Lunar Base and Colony Ship. The Colony Ship is not a victory. It sets a launched flag, fires a story event and calls `PlanetGalaxy.onLaunch`.

**Galaxy hook (`galaxy.js`).** This is a stub that only records launches. The future galaxy layer starts from `PlanetGalaxy.launches(game)`.

**Story (`story.js`, `storydata.js`, `storyui.js`).** 47 data-driven events can trigger on turn or era, famine, unrest, first contact, wonder built, war start or end, capital lost, river city, city size or anomaly. The pick is weighted and seeded, with cooldowns and flag-based chains: the Sunken Stair, the Humming Stone, the Grey Cough, the Heretic Prophet, the Lost Expedition, the comet, the flood and the defector. Each event card has a procedural vignette, text filled with names, and 2–3 choices, some gated by traits. AI civs resolve their events silently.
**Anomalies** are about 1 per 300 land tiles. A unit can investigate one in 1–3 turns. They are marked with a violet dashed hex and a "?", and they respect fog.
**The Chronicle** (key C) is your civ's history in prose, grouped by era. It is saved with the game and can be exported as Markdown.
**Golden and dark ages** come from happiness, wars and events (at most one every 30+ turns) and give ±1 production and gold per city.

## Slice 13: peace treaties, real icons, animations

**Top bar.** One row at 1280 px: Diplomacy, Trade, Wonders, Chronicle, Save and the new Settings are icon buttons with tooltips (the pending-request count sits as a badge on Diplomacy). Gold, science and happiness use the stat icons.

**Peace (peace.js).**
- War score per war, from each side's view, from -100 to +100: kills ×4, cities taken ×15, battles in the last 10 turns ×1.5 (a hit counts half), and relative strength up to ±20. Weariness runs from 0 to 60: turns at war ×1.2, plus 3 per unit lost (a city counts as 3). `Combat.attack` and city strikes report into the tally.
- During a war, the deal screen becomes **Peace talks**. It shows a war-score meter, the tallies and both sides' weariness. Both sides can offer gold, gold per turn, techs, luxuries, maps or non-capital cities. There is a **White peace** button, and **What would they want?** proposes terms. AI need = 3 × score − 2 × weariness (+10 if militaristic). The AI signs if what it gets is at least that.
- Peace by any route (treaty, white peace or an older offer) starts a **10-turn truce**. `declareWar` refuses during the truce, and the AI also waits 30 turns after a peace before attacking the same civ again.
- The AI proposes terms. A winner names a price (gold, a tech, a border city if it is crushing) once the war has dragged on. A loser offers gold or luxuries. Proposals reach you as **"X offers peace terms"** under Diplomacy (Accept / Counter / Decline). AI-to-AI peace uses the same evaluator.
- War frequency: rivalry now builds **tension** each turn while relations are cool. When tension boils over and the odds look even (or a long grudge outweighs the odds), war follows.
- The Diplomacy panel shows "War score ±N · turns" on each row at war, plus the truce countdown.

**Icons (icons.js).** One sprite of 105 hand-authored vector icons on a 24-unit grid: flat fill, one accent and a dark outline painted behind. It covers 13 resources (coal, aluminum and uranium are drawn for later), 29 unit silhouettes tinted by era, 20 buildings, 5 projects, 16 wonders, 6 stats, and markers (anomaly kinds, event, war, peace, capture, UI). `Icons.svg()` feeds panels. `Icons.draw()` rasterizes once per icon, pixel size and colour, then blits from the cache. The legend, city panel (build list and buildings), Wonders panel, top bar and map tokens all use it. `?icons=1` shows the whole sheet.

**Animations (anim.js, drawn by app.js).**
- Units: tweens along their real path (120 ms per hex). Visible AI moves play one after another at about 70 ms per hex, squeezed into about 3 s at most. Moves that are off-screen or fogged are instant. **Skip ▸▸** (or Space/Enter) cuts the playback short.
- Combat: lunge, hit flash, screen shake and floating damage. Dying units fade and sink in a puff of dust. Projectiles are arrows, cannonballs with smoke or shells. Rockets come from rocket artillery and missile cruisers. Ships fire a shell before they strike.
- Cities: a growth pulse, a sparkle when something is built, a fade when borders expand, and a flag swap on capture.
- World: water shimmers and river flow drifts at close zoom (throttled to about 30 fps when nothing else moves). Fog edges are soft.
- UI: panels slide or fade, the gold counter ticks, and toasts ease in and out. The camera glides to the next unit after a turn and to summary targets.
- Settings (gear button): animations on or off, speed 0.5×–4×, AI moves, ambient water. These are stored in localStorage under `civPlanet.anim`.

**Save v9.** Adds `game.peace` (war tallies, truces, treaty history, tension). The v8 → v9 migration leaves it empty. An ongoing war gets a fresh tally on load.

## Slice 14: wonder spread

- Cause: the autoplayed civ 0 was the strongest economy (about 2x production, 1000+ gold) and **bought** most of its wonders (8 of 11 on seed q1, 6 of 11 on marco). On top of that, any wonder outscored a normal building (3.2 + era bonus vs 3), and the penalty was only 0.5 per wonder owned. Races were rarely lost (0 to 2 per game), so racing was not the cause.
- `Wonders.AFFINITY` tags every wonder with traits. With a matching trait the score is 4.2+; without one, a wonder is only considered when the city can finish it in 22 turns or less (and scores low unless it takes 12 or less).
- Interest drops by 0.7 per wonder owned plus 1.4 per wonder above a fair share; a civ with no wonder gets +0.8.
- Race awareness (`Wonders.race`/`aiReview`): each turn the AI compares its turns to finish against known (met) rivals building the same wonder. If it is clearly losing, it switches to another build. `city.prod` carries over. Abandoned races are logged and counted in `game._wonderStats` (session only, not saved).
- The AI only buys wonders that match its affinity, when it is not above its fair share and not losing a race.
- Empires with 5+ cities may build a second affinity wonder in their next-best city.
- No save change (still v9).

## Slice 15: units and warfare (pass A), civ identity (pass B)

### Strategic resources
Horses and Iron (now strategic), and Coal, Aluminum and Uranium (new, placed by seed in a second mapgen pass on fitting biomes: Coal on hills/forest/plains, Aluminum on desert/plains/hills, Uranium on tundra/desert/jungle/hills). They stay hidden until Animal Husbandry, Mining/Bronze Working (as before), **Steam Power** (Coal), **Electricity** (Aluminum) and **Nuclear Fission** (Uranium).

Each source tile inside your borders supplies **4** units when improved (or a city sits on it), 2 when not; traded resources add 4. Units beyond the supply (newest first) fight at **−50%**, and you can't start a unit or building that needs a resource with nothing free. Needs: Horseman, Knight → Horses; Swordsman, Frigate → Iron; Ironclad, Destroyer, Battleship, Carrier, Factory → Coal; Fighter, Bomber, Jet Fighter, Stealth Bomber, Helicopter, Rocket Artillery, Modern Armor → Aluminum; Missile Cruiser and the **Nuclear Plant** (+25% production) → Uranium. Upgrades check supply too. The ore-cart button in the top bar shows *used / supply* per resource (red badge = units over the limit). Deals offer *Strategic: X (+4 units, 30 turns)*; the AI values what it lacks and buys missing resources from friendly neighbours.

### Air units
Flight: **Fighter** (air 40, strike 30, range 8) and **Bomber** (strike 55, +50% vs cities, range 10); Radio: **Anti-Aircraft Gun** and +25% city defense against air; Radar: **Jet Fighter** and **Carrier** (3 planes); Combined Arms: **Helicopter Gunship** (a land unit); Stealth: **Stealth Bomber** (range 14, evades interceptors). Planes live in a city (up to 4) or on a carrier and fly missions instead of moving: **Strike** (A: click a highlighted target in range; bombing can't take a city, it stops at 1 HP), **Rebase** (Q) and **Intercept patrol** (P: the strongest patrolling fighter, or AA gun within 2, hits incoming strikes). Missions animate as a flyover with a ground shadow and contrail. Air units don't garrison or capture.

### Promotions and XP
XP: +5 for attacking (+3 ranged), +5 for a kill, +4 for surviving a defence. Levels at 10 / 30 / 60 / 100 / 150 / 220 XP each give one pick from the class tree: melee **Shock** (open), **Drill** (rough), **Cover** (vs ranged and air), then **Medic**, **Blitz**; ranged **Accuracy**, **Barrage**, then **Range +1**, **Logistics**; naval **Boarding**, **Coastal Raider**, then **Navigation**; air **Interception**, **Siege**, **Evasion**, then **Air Range**. Gold stars above the token count promotions, a yellow **+** means one is ready (pick it in the unit panel). Promotions survive upgrades. Barracks (and Terracotta Army, events) give 10 XP instead of the old veteran flag. The AI picks by role and terrain.

### Orders and stacking
Click a tile beyond this turn's reach to **go there**: the path is previewed with numbered turn markers and continues each turn; it stops (with a notice) when an enemy comes within 2. **Shift+click** adds a waypoint. **S** sentry (wakes on enemies), **E** explore, **X** cancels, **N** or **.** cycles units needing orders, and End Turn warns once per turn while units are idle. Stacking: one military unit per domain per tile (land, sea) plus one civilian; your own cities hold 2 land units and 3 ships, planes are counted separately. Moving onto a friendly unit **swaps** places.

### Naval AI and upgrades
Warship builds scale with coastline, enemy fleets and invasion plans. At war the AI hunts ships (transports first), escorts its transports, shells coastal cities before a landing and runs amphibious invasions (gather → sail → bombard → land) against overseas targets, and it is slower to accept peace mid-invasion. It upgrades obsolete units with spare gold (garrisons and front line first) and disbands one hopelessly outdated unit a turn when broke.

### Governments and policies (G)
| Government | Unlocked by | Slots | Effects |
|---|---|---|---|
| Despotism | start | 1 military, 1 economic | −1 on tile yields above 2 · +1 production in the capital |
| Monarchy | Currency | 1 mil, 1 eco, 1 wild | +1 happiness per garrisoned city (max 4) · +2 gold in capital · 1 more free unit per city |
| Theocracy | Theology | 1 mil, 1 eco, 1 diplo | +2 faith per city · Temples +1 happiness · −10% science |
| Republic | Philosophy | 2 eco, 1 diplo | +1 gold on gold tiles · +10% science · war weariness ×1.5 |
| Autocracy | Rifling | 3 mil, 1 eco | units −20% cost · +10% strength · −1 happiness per 4 cities |
| Communism | Industrialization | 1 mil, 2 eco, 1 wild | +2 production in every non-capital city · −1 gold per city |
| Democracy | Economics | 2 eco, 1 diplo, 1 wild | +15% science and gold · +1 happiness per 2 cities · war weariness ×2 |
| Technocracy | Computers | 2 eco, 2 wild | +30% science · −10% gold |

Switching costs **2 turns of anarchy** (no gold or science, −25% production, policies off). 21 policy cards (6 military, 8 economic, 5 diplomatic, 2 wildcard), unlocked by techs; a wildcard slot takes any card. Changing cards is free once a slot's category has rested 10 turns, otherwise it costs gold. Same government +1 attitude, opposed families −1. The AI picks by traits (militaristic → Autocracy, scholarly → Technocracy/Republic, and so on). Revolutions go into the log and the Chronicle.

### Faith, religion and ideology (L)
Faith comes from the **Shrine** (Mysticism), Temples, faith wonders, **holy sites** (cities next to mountains or anomalies), Theocracy and some cards. At **70 faith** a civ founds a religion while slots remain (cap ⌊civs/2⌋+1). You get a founding card: a generated name you can edit or reroll, a colour, one of 6 founder beliefs (Tithes, Pilgrimage, Holy Warriors, Papal Primacy, World Church, Sacred Charter) and one of 6 follower beliefs (Monastic Science, River Goddess, Sacred Groves, Feed the World, Religious Art, Choral Music); each belief exists once per world. Religions spread by pressure from cities within 14 tiles (8 before slice 16), along trade routes and from met civs at peace, and by **Missionaries** (Theology, or 120 faith; 2 charges). City plates show the religion's coloured icon. Your empire's majority faith matters for happiness and attitude: shared faith +1 (+2 if zealous), a different majority faith −1 (zealous −2, "Heretics"). Entering the Industrial era asks for an **ideology**: Freedom, Order or Autonomy, each with 4 tenets earned one per era; same ideology +2 attitude, different −2. Six religion events (founding, heresy, pilgrims, schism, relic, ideology) and Chronicle lines cover religion and government changes.

### Saves
Version **11**. v9 → v10 adds `strategic`, `air`, `promo`, `navalai`, turns `unit.vet` into `unit.xp` (10 or 0) and adds `promos`, `goto`, `order`; v10 → v11 adds `gov`, `religion` and city `rel` / `relp`. The map hash ignores the new deposits, so old saves keep matching their seed.

### Tests
`node tests/t15.js` (103 checks: resources, air, XP, goto/stacking, scripted naval invasion, governments, policies, religion, save/load deep-equal and v8/v9/v10 migrations).

## Slice 16: AI tuning, pillage and plunder

### Pillage (P)
A land military unit at war, standing on an enemy-owned road or improvement (not a city), can **Pillage** for 1 move: the improvement goes first (a second pillage burns the road), the unit gains gold (improvement 15 + 5×era, road 6 + 2×era) and heals 10 HP. The tile is marked pillaged (ash patch with an orange mark) and yields nothing extra until repaired. The owner's Workers get a **Repair** job there (1 turn, 2 on rough ground) that restores both road and improvement, instead of the 3-turn rebuild. A pillaged road breaks the capital connection (and its gold) until repaired. The action plays a smoke-and-flame puff. AI units at war pillage the enemy tile they stand on and sometimes step onto an adjacent undefended improvement to burn it; AI Workers repair their own pillaged tiles first when no enemy is within 2 tiles.

### Plunder
A military unit at war that ends a move on a tile of an enemy trade route's path (the straight hex line between the two cities; land units on land, ships on water legs) destroys the route and takes 20 + 4×era + 2×route gold. Moving next to an enemy Caravan captures its cargo (30 + 5×era gold, caravan lost). Both sides get a log line and turn-summary entry (Pillage / Plunder tags) and a Chronicle line when you are involved. AI Caravans wait at home instead of walking a route that crosses enemy land or passes within 2 tiles of enemy troops.

### AI tuning (`aitune.js` plus small edits)
- **Religion:** pressure range 14, pressure decays 4% a turn (so the stronger faith wins instead of every faith sitting at the cap), holy cities hold their faith, trade routes carry 9, and every met civ at peace leaks its majority faith into your cities (+1 with open borders). Missionaries may enter any land not at war and halve rival pressure where they preach. AI founders buy more Missionaries (2 + 2 if zealous + 1 per 4 cities), target unconverted and foreign cities first, and with spare faith (260+) send an **overseas mission** (150 faith → pressure in the nearest unconverted city of a met civ). Different majority faiths now cost −1 attitude (zealous −2).
- **Air and naval:** fighters rebase to the most threatened city and fly intercept patrols, bombers strike at lower odds, AA guns are built when enemy bombers are within 12 tiles. An overseas war plans a landing when the enemy city on your own landmass is far (14+) or much farther than the overseas one; the overseas reach grows with the era; an ocean-going transport is built if all you have are Triremes; transports on duty are never upgraded into cargo-less warships; voyages use the multi-turn pathfinder; troops land on arrival; an AI with a fleet at sea refuses peace (up to 50 turns) unless losing badly.
- **Resource limits:** an AI won't queue a unit whose resource has no free supply (counting other cities' queues). After every turn an AI over a limit first tries to buy the resource (up to 60 gold for 30 turns) and otherwise disbands its newest unsupported units.
- **Wars:** after turn 100 a seafaring AI at peace with everyone may pick a war with a weaker, cool (attitude ≤ 3) rival it has no alliance with (1 chance in 30 per turn per pair, never within 40 turns of a peace).

### Saves
Version **12**: v11 → v12 adds `game.pillage` (pillaged tiles and stats) and `game.aitune` (counters), both null until used.

### Tests
`node tests/t16.js` (29 checks: pillage yield loss, repair, trade-connection cut and reconnect, plunder of route/caravan/sea leg, no plunder at peace, unsafe caravan routes, AI resource compliance incl. a 180-turn autoplay with peak over-limit 0, save/load deep-equal with pillaged tiles and the v11 → v12 migration).

## Art test: low-poly Diorama mode (`diorama.js`)

Switchable map art: Settings (gear) → Art style → Classic / Diorama, remembered in
localStorage; `?art=diorama` forces it for one load. Default is Classic.

- Top-down on the same pointy-top grid (overlays, fog, picking stay aligned). Each hex is a
  raised block: 12 flat-shaded facets on an inset top (fixed top-left light), side walls down to
  a common base, a groove between blocks, light/dark bevel edges. Heights: ocean −0.24R,
  coast −0.18R, flat land 0, forest +0.03R, hills +0.13R, mountains +0.22R.
- Props baked per biome × 3 variants: cone pines (forest), broadleaf clumps (jungle), faceted
  mounds (hills), snow-capped faceted peaks (mountain), dunes, rocks, bushes, wheat tufts.
- Sprites are rendered lazily per biome/variant/size bucket (quarter-octave buckets) into
  offscreen canvases; tiles are drawn back to front by screen y (row-culled).
- Rivers get a turquoise ribbon with a light streak; the territory tint is lighter (0.10).
- Spearman and Warrior: low-poly figurine on a hex base (civ tunic, shield, rim). Cities:
  house-and-tower cluster in civ colours, 3 population tiers (1–3, 4–7, 8+), with a small
  emblem badge. Far zoom falls back to the classic badge/token.
- Screenshot stage: `?autoplay=60&art=diorama&artshot=play|close|world[&perf=1]`.

## Slice 17: organic wars, air doctrine, invasions (`aiwar.js`)

No save bump: new state lives in `game.aitune.aw` (saved with aitune); units may carry `siege`/`siegeWait`.

- **War drivers** (AI only; the player is never made to declare). New attitude reasons: *Contested lands*
  (cities within 7 tiles where one sits off its home landmass, up to −3), *They hold the X we lack*
  (a strategic resource we have none of and they have 4+, up to −2), *Great-power rivalry* from the
  Industrial era between the stronger half of civs (−1, −2 with different ideologies). Motives per pair:
  opportunism (rival already at war, or we are 1.5× stronger), competition, rivalry, grudge (attitude ≤ 0).
  A moving average of civs at war throttles new wars (none above 15%); a long world peace lowers the bar
  ("the long quiet frays"). Wars state their motive in the log ("…declared war on X (seizing the moment)").
- **Pacts age**: defensive pacts/alliances come up for renewal every 50 turns and lapse unless attitude ≥ 6 (7
  for alliances); a pact that no longer fits the mood can be cancelled; a lapsed pact can't be re-signed for 40 turns.
- **War exhaustion** (AI vs AI): white peace after 60 turns, or 35 while the world is busy fighting.
- **Overseas war plans**: an AI that wants an overseas war but has no modern transport waits up to 30
  turns and orders the best transport hull in its port nearest the target; obsolete hulls (strength
  < 60% or cargo < 60% of the best buildable) are not used for invasions.
- **Invasions** (`navalai.js`): stage at the port nearest the target that has a sea lane to a landing site;
  per-hull drop sites (triremes can't cross ocean); inland targets get a beach landing within 4 tiles;
  landing sites prefer cover, frontage (free land beside the drop), and stay out of a gunned city's
  2-tile strike ring; no plan without an escort when the enemy has warships; armies of up to 6 (min 4 or
  the hull's capacity); two waves may be at sea and follow-up waves go to the same city; soft targets
  (no walls/capital guns, few defenders) preferred.
- **Sieges**: troops landed by sea get `siege = cityId`; they pull back 3 tiles from a gunned city and
  fortify until 4 are ashore (or the walls are under 50), then close in and assault; warships shell the
  besieged city; an active siege with the walls under 70 blocks peace.
- **Air**: bombers and fighters strike units in the field, ships (+6), raiders near home (+6) and
  siege/invasion targets (+10); aircraft rebase toward the nearest visible enemy; air builds scale with
  cities, era, war and threat (enemy aircraft, troops within 8 of the city).
- Tests: `node tests/t17.js`.
