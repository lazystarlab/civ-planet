/*
 * storydata.js — THE EVENTS (data only; story.js runs them).
 * Each event: { id, title, trigger, era: [min, max], turns, weight, cooldown,
 *   needs / not (chain flags), rival (needs a known civ), likes (traits that
 *   make it more likely), cond(game, cid, ctx), art: { motif, tint },
 *   text, choices: [{ label, trait?, effects, result }] }.
 * Effects: gold, food, prod, science, boost (share of current research),
 *   happy: [v, turns], mod: [food|prod|gold|sci, v per city, turns], att (with
 *   the event's rival), attAll, unit: melee|ranged|ship, pop, reveal (radius),
 *   flag, unflag, chain: [eventId, delay], age: golden|dark.
 * Text tokens: {civ} {leader} {title} {people} {adj} {city} {capital} {rival}
 *   {rivalLeader} {rivalPeople} {year} {era} {wonder}.
 * Eras: 0 Ancient, 1 Classical, 2 Medieval, 3 Renaissance, 4 Industrial,
 *   5 Modern, 6 Information, 7 Space.
 */
(function (root) {
  "use strict";
  function coastal(game, cid, ctx) {
    var c = ctx.city != null ? root.PlanetGame.cityById(game, ctx.city) : null;
    return !!(c && root.PlanetNaval && root.PlanetNaval.coastal(game, c));
  }
  function hasB(b) { return function (game, cid) { return root.PlanetGame.citiesOf(game, cid).some(function (c) { return (c.buildings || []).indexOf(b) !== -1; }); }; }

  var EVENTS = [
    // ------------------------------------------------ religion (slice 15)
    { id: "rel_founded", title: "The First Sermon", trigger: "religion_founded", art: { motif: "crown", tint: "#c8a040" }, cooldown: 0,
      text: "On the steps of {city} a preacher speaks of the new faith, and for once the market falls silent to listen. Some weep; some laugh; the priests of the old shrines watch from the shade and say nothing at all.",
      choices: [
        { label: "Build a great house for the faith.", effects: { prod: 30, faith: 20 }, result: "Masons volunteer their labour. The foundations rise before the first frost." },
        { label: "Send the preacher on the road.", effects: { pressure: 80, faith: 10 }, result: "The preacher walks out of the gate with a staff and a sack of bread." },
        { label: "Let the old priests and the new share the temple.", effects: { happy: [2, 15] }, result: "An uneasy peace at the altar. Both sides claim the other is learning." } ] },
    { id: "rel_heresy", title: "A Heresy in the Hills", trigger: "turn", era: [1, 5], weight: 2, cooldown: 60,
      cond: function (game, cid) { var R = root.PlanetReligion; return !!(R && R.founded(game, cid)); },
      art: { motif: "flame", tint: "#a04a3a" },
      text: "In the hill villages above {city}, a wandering ascetic teaches that the faith of {civ} has grown fat. His followers burn their tithe-tallies and sing in the old tongue. The bishops want him silenced; the villagers want him fed.",
      choices: [
        { label: "Hear him out at a council.", effects: { science: 30, happy: [-1, 6] }, result: "The council argues for nine days. Some of his ideas are quietly written into the creed." },
        { label: "Silence him.", effects: { faith: 25, happy: [-2, 8] }, result: "He is taken in the night. The hills remember." },
        { label: "Make him a saint while he is still alive.", trait: "nomadic", effects: { faith: 40, happy: [2, 10] }, result: "He is mortified. The pilgrims come anyway." } ] },
    { id: "rel_pilgrims", title: "Pilgrims at the Gate", trigger: "turn", era: [1, 7], weight: 2, cooldown: 50,
      cond: function (game, cid) { var R = root.PlanetReligion, r = R && R.founded(game, cid); return !!(r && R.followers(game, r.id).some(function (c) { return c.owner !== cid; })); },
      art: { motif: "tree", tint: "#8a7a5a" },
      text: "They come from foreign cities that took our faith as their own: dusty, footsore, singing hymns in accents our priests can barely follow. {city} has never been so crowded, nor its innkeepers so rich.",
      choices: [
        { label: "Tax the pilgrims' road.", effects: { gold: 70 }, result: "The toll-house does brisk business. The hymns grow a little sour." },
        { label: "Feed them for free.", effects: { faith: 30, attAll: 1 }, result: "Word spreads to every city on the road: the holy city keeps its doors open." } ] },
    { id: "rel_schism", title: "The Two Candles", trigger: "turn", era: [2, 7], weight: 1.5, cooldown: 80,
      cond: function (game, cid) { var R = root.PlanetReligion; return !!(R && R.state(game).list.length >= 2); },
      art: { motif: "eye", tint: "#5a4a7a" },
      text: "Two faiths now share our borders, and the quarrel over whose candles burn in the market square has turned to stones and broken shutters in {city}. The magistrates ask what the law of {civ} says about God.",
      choices: [
        { label: "Proclaim freedom of worship.", effects: { happy: [2, 12], science: 20 }, result: "Both candles burn. Neither side is pleased, which the magistrates take as a good sign." },
        { label: "Back the faith of the majority.", effects: { faith: 40, happy: [-1, 8] }, result: "The minority keeps its candles indoors. For now." } ] },
    { id: "rel_ideology", title: "The Century's Quarrel", trigger: "ideology", art: { motif: "scroll", tint: "#5a6a8a" }, cooldown: 0,
      text: "Pamphlets, rallies, a brass band on every corner: the new ideology has swept through {capital} like a fever. Old {title} {leader} watches the marching columns from the balcony and wonders who is leading whom.",
      choices: [
        { label: "Harness the fervour: build.", effects: { mod: ["prod", 1, 15] }, result: "Factories run double shifts under new banners." },
        { label: "Open the universities to the debate.", effects: { boost: 0.35 }, result: "Every lecture hall is full, and every argument is loud." },
        { label: "Cool it down. Bread before banners.", effects: { happy: [3, 12] }, result: "The bands play fewer marches and more waltzes." } ] },
    { id: "rel_relic", title: "The Relic of {city}", trigger: "turn", era: [0, 4], weight: 1.5, cooldown: 90,
      cond: function (game, cid) { var R = root.PlanetReligion; return !!(R && R.state(game).civ[cid] && R.state(game).civ[cid].faith >= 20); },
      art: { motif: "ruin", tint: "#b08a4a" },
      text: "Diggers widening a well in {city} found a small box of cedar, and in it a finger-bone wrapped in gold thread. The priests declare it holy; the merchants declare it valuable; the well-diggers would like their bonus.",
      choices: [
        { label: "Enshrine it.", effects: { faith: 35, happy: [1, 10] }, result: "A reliquary is commissioned. The well is finished too, eventually." },
        { label: "Sell it to a foreign collector.", effects: { gold: 90, faith: -10 }, result: "It leaves in a locked chest. Some say the well tastes bitter now." } ] },

    // ------------------------------------------------ anomaly: the sunken stair (3 steps)
    { id: "ruins_1", title: "The Sunken Stair", trigger: "anomaly:ruins", art: { motif: "ruin", tint: "#7a6a4a" }, cooldown: 0,
      text: "Beneath a ring of broken pillars near {city}, our scouts found a stair cut into living rock, spiralling down past the reach of their torches. The air that rises from it is warm, and smells faintly of cedar.",
      choices: [
        { label: "Send a team down the stair.", effects: { science: 20, flag: "stair", chain: ["ruins_2", 3] }, result: "Ropes are fetched. The torches dwindle into the dark." },
        { label: "Seal it. Some doors are closed for a reason.", effects: { happy: [2, 10] }, result: "Masons wall the stair shut. The town sleeps easier." },
        { label: "Let the scribes copy every carving first.", trait: "scholarly", effects: { science: 45 }, result: "Three months of rubbings fill a storeroom in {capital}." } ] },
    { id: "ruins_2", title: "Voices Below", trigger: "chain", needs: "stair", art: { motif: "ruin", tint: "#4a4060" },
      text: "Ninety steps down, the stair opens into a hall of painted walls. The figures on them walk in a long procession, carrying seeds and stars. Our people swear the painted faces look like their grandparents.",
      choices: [
        { label: "Follow the procession deeper.", effects: { boost: 0.3, chain: ["ruins_3", 4] }, result: "The team goes on. A runner returns with only one word: 'More.'" },
        { label: "Strip the gold leaf and come home.", effects: { gold: 90, unflag: "stair" }, result: "The paintings are scraped bare. The gold is real enough." } ] },
    { id: "ruins_3", title: "The Last Mural", trigger: "chain", needs: "stair", art: { motif: "eye", tint: "#2e3c6a" },
      text: "The procession ends at a single mural: a city on a river, a people leaving it in boats, and above them a star that is not in our sky. Whoever painted this knew our land — and left it long ago.",
      choices: [
        { label: "Make the hall a shrine to the first ones.", effects: { happy: [3, 30], flag: "first_ones", mood: 1 }, result: "Pilgrims begin to come. They leave seeds at the foot of the mural." },
        { label: "Study the star. Copy it to every observatory.", effects: { boost: 0.6, flag: "strange_star" }, result: "Astronomers argue for decades about where that star should be." },
        { label: "Tell no one. Wall it up again.", effects: { gold: 40 }, result: "{title} {leader} keeps the secret, and takes it to the grave." } ] },

    // ------------------------------------------------ anomaly: crater
    { id: "crater_1", title: "Heaven's Anvil", trigger: "anomaly:crater", art: { motif: "comet", tint: "#6a3a2a" }, cooldown: 0,
      text: "A bowl of fused glass, a mile across, where nothing grows. At its centre lies a black stone that rings like a bell when struck and draws iron nails toward it.",
      choices: [
        { label: "Forge blades from the star-iron.", effects: { unit: "melee", attAll: 0 }, result: "The smiths of {city} work day and night. The blades never dull." },
        { label: "Sell it piece by piece to collectors.", effects: { gold: 90 }, result: "Fragments of the sky are traded as far as {rival}." },
        { label: "Build a foundry beside it.", trait: "industrious", effects: { mod: ["prod", 1, 20] }, result: "Furnaces ring the crater. Their smoke can be seen for days." } ] },

    // ------------------------------------------------ anomaly: monolith (2 steps)
    { id: "monolith_1", title: "The Humming Stone", trigger: "anomaly:monolith", art: { motif: "monolith", tint: "#3c4a5a" }, cooldown: 0,
      text: "A slab of dark stone, perfectly smooth, taller than three men. At dawn it hums — a low note that the dogs of {city} can hear from a day's walk away.",
      choices: [
        { label: "Study it. Measure the hum.", effects: { science: 30, flag: "monolith", chain: ["monolith_2", 8] }, result: "Musicians and mathematicians camp at its foot." },
        { label: "Topple it and use the stone.", effects: { prod: 45 }, result: "It takes forty oxen. The hum stops the moment it falls." },
        { label: "Worship it.", effects: { happy: [2, 20] }, result: "A priesthood forms within a season." } ] },
    { id: "monolith_2", title: "It Answered", trigger: "chain", needs: "monolith", art: { motif: "eye", tint: "#24384a" },
      text: "One of the musicians played the stone's own note back to it on a bronze horn. The monolith answered — a long pattern of rising tones, never repeated. The scholars of {capital} have not slept since.",
      choices: [
        { label: "Write the pattern down. All of it.", effects: { boost: 1.0, flag: "pattern" }, result: "The notation fills a hundred scrolls. Some of it looks like arithmetic." },
        { label: "Bury it under a hill of earth.", effects: { happy: [2, 15], unflag: "monolith" }, result: "The hill grows grass in a single spring." } ] },

    // ------------------------------------------------ anomaly: spring
    { id: "spring_1", title: "The Warm Spring", trigger: "anomaly:spring", art: { motif: "wave", tint: "#2f6a6a" }, cooldown: 0,
      text: "Water bubbles from the rock here at the warmth of blood, tasting of iron and salt. The sick who bathe in it swear they feel younger. Some of them may even be right.",
      choices: [
        { label: "Build baths and let everyone come.", effects: { happy: [2, 25] }, result: "The baths of {city} become the talk of the realm." },
        { label: "Bottle it and sell it.", effects: { gold: 60 }, result: "Clay flasks of the 'water of youth' sell briskly to {rival}." },
        { label: "Channel it into the fields.", trait: "agrarian", effects: { mod: ["food", 1, 20] }, result: "The barley never grew so tall." } ] },

    // ------------------------------------------------ anomaly: wreck → the lost crew
    { id: "wreck_1", title: "The Ship in the Sand", trigger: "anomaly:wreck", art: { motif: "ship", tint: "#5a4a3a" }, cooldown: 0,
      text: "A hull of dark timber lies on the dunes, far above any tide our people remember. Its figurehead is a woman holding a lamp, and in the captain's cabin a sealed logbook waits.",
      choices: [
        { label: "Salvage the timbers.", effects: { prod: 40 }, result: "The keel becomes the roof beam of a new hall in {city}." },
        { label: "Read the logbook.", effects: { reveal: 10, flag: "logbook" }, result: "Its charts show coasts our captains have never seen." },
        { label: "Rebuild her and put to sea.", trait: "seafaring", effects: { unit: "ship" }, result: "She floats. The old figurehead still holds her lamp." } ] },

    // ------------------------------------------------ the comet (returns generations later)
    { id: "comet_1", title: "A Tail of Fire", era: [0, 2], weight: 8, art: { motif: "comet", tint: "#3a2a5a" },
      text: "For nine nights a comet hangs over {capital}, its tail stretched across half the sky. Crowds gather on the rooftops. Every faction in the city insists it is an omen, and every one of them is sure it favours them.",
      choices: [
        { label: "Declare it an omen of our greatness.", effects: { happy: [2, 10], flag: "comet" , chain: ["comet_2", 60] }, result: "Festivals last until the comet fades." },
        { label: "Have the astronomers chart its path.", effects: { science: 35, flag: "comet", chain: ["comet_2", 60] }, result: "Their chart predicts it will return. Few believe them." },
        { label: "Rally the army beneath it.", trait: "militaristic", effects: { unit: "melee", flag: "comet", chain: ["comet_2", 60] }, result: "The legions march out under a burning sky." } ] },
    { id: "comet_2", title: "The Wanderer Returns", trigger: "chain", needs: "comet", art: { motif: "comet", tint: "#203060" },
      text: "Sixty years after it first lit the sky, the comet has returned, exactly where the old charts said it would. The people of {civ} look up at it now with the eyes of the {era} Era: their grandparents' omen has become a measured thing.",
      choices: [
        { label: "Honour the old astronomers who predicted it.", effects: { science: 80, happy: [1, 10] }, result: "Their names are carved over the door of every school." },
        { label: "Hold the festival again, as our ancestors did.", effects: { happy: [3, 12] }, result: "Old songs are sung by people who never knew the words." } ] },

    // ------------------------------------------------ early days
    { id: "harvest_1", title: "The First Harvest Festival", era: [0, 1], weight: 9, art: { motif: "tree", tint: "#6a5a2a" },
      text: "The granaries of {city} are full for the first time anyone can remember. The elders want a feast; the young want a dance; the priests want a tenth of everything, as usual.",
      choices: [
        { label: "Feast until the stores are half empty.", effects: { food: -15, happy: [3, 8] }, result: "The songs from that night are still sung." },
        { label: "Keep the grain. Winter is long.", effects: { food: 20 }, result: "The granary doors stay shut. The winter is long." },
        { label: "Trade the surplus downriver.", trait: "mercantile", effects: { gold: 45 }, result: "Barges of grain come back as barges of copper." } ] },
    { id: "wolves_1", title: "Wolves in the Hills", era: [0, 1], weight: 8, art: { motif: "eye", tint: "#3a4a3a" },
      text: "A pack of grey wolves, bolder than any the herders have seen, has been taking sheep within sight of {city}. Children are kept indoors. Someone says the pack is led by a white wolf that cannot be killed.",
      choices: [
        { label: "Send the young warriors to hunt them.", effects: { unit: "melee" }, result: "They come back with a white pelt and a lot of new scars." },
        { label: "Build pens and keep watch.", effects: { prod: -10, happy: [1, 10] }, result: "The wolves move on to easier sheep." },
        { label: "Leave offerings to the white wolf.", effects: { happy: [2, 10], flag: "white_wolf" }, result: "The attacks stop. The white wolf appears on banners for centuries." } ] },
    { id: "storyteller_1", title: "The Storyteller", era: [0, 2], weight: 7, art: { motif: "flame", tint: "#5a3a2a" },
      text: "An old blind woman sits by the fire in {capital} every night and tells the story of the {people}: where they came from, who they fought, why the river bends. Each night the story is a little longer.",
      choices: [
        { label: "Have the scribes write it down.", effects: { science: 25, flag: "saga" }, result: "The first book of the {people} is a story about themselves." },
        { label: "Let it live in the telling.", effects: { happy: [2, 15] }, result: "Every child in {civ} learns it by heart, and changes it a little." } ] },

    // ------------------------------------------------ river, flood, famine
    { id: "flood_1", title: "The Great Flood", trigger: "river_city", cooldown: 60, art: { motif: "wave", tint: "#28486a" },
      text: "After a winter of heavy snows, the river rose in a single night and walked into {city}. Granaries are ruined, the lower town is a lake, and the river spirits are being blamed loudly.",
      choices: [
        { label: "Rebuild on higher ground.", effects: { gold: -40, mod: ["food", 1, 10] }, result: "The new quarter is built on the bluffs, safe and dry." },
        { label: "Let the waters teach us: the silt will feed us.", effects: { pop: -1, mod: ["food", 2, 12] }, result: "When the waters fall, the fields are black and rich." },
        { label: "Raise levees along the whole river.", trait: "industrious", effects: { prod: -30, flag: "levees", happy: [2, 20] }, result: "Earthworks rise along the banks. The next flood never comes." } ] },
    { id: "famine_1", title: "Empty Granaries", trigger: "famine", cooldown: 25, art: { motif: "tree", tint: "#5a4a2a" },
      text: "In {city} the bread lines are long and getting longer. Mothers are trading jewellery for millet. The governor has written to {title} {leader} three times this week.",
      choices: [
        { label: "Open the royal stores.", effects: { gold: -50, food: 30 }, result: "Carts of grain roll through the gates. The lines shorten." },
        { label: "Ration everything, everywhere.", effects: { happy: [-2, 10], food: 15 }, result: "Nobody starves. Nobody is happy about it either." },
        { label: "Call on the old seed-keepers.", trait: "agrarian", effects: { food: 45 }, result: "Hidden stores of hardy grain are planted in time." } ] },

    // ------------------------------------------------ the grey cough (3 steps)
    { id: "plague_1", title: "The Grey Cough", trigger: "city_size", era: [1, 5], weight: 6, art: { motif: "plague", tint: "#4a5a3a" },
      text: "A cough that leaves its victims grey and shaking has appeared in the crowded quarters of {city}. The physicians disagree on everything except that it is spreading.",
      choices: [
        { label: "Close the gates. Quarantine the city.", effects: { mod: ["prod", -1, 8], flag: "plague", chain: ["plague_2", 3] }, result: "The gates swing shut. Inside, the bells keep ringing." },
        { label: "Keep trade open and pray.", effects: { pop: -2, flag: "plague", chain: ["plague_2", 3] }, result: "The markets stay busy. So do the gravediggers." } ] },
    { id: "plague_2", title: "Bells for the Dead", trigger: "chain", needs: "plague", art: { motif: "plague", tint: "#3a3a3a" },
      text: "The cough has reached the outer villages. A young physician in {city} claims it lives in the water, not the air, and begs for authority to close the old wells.",
      choices: [
        { label: "Give her the authority.", effects: { gold: -40, flag: "physician", chain: ["plague_3", 4] }, result: "The wells are capped. Within a month, the coughing quiets." },
        { label: "Burn the sick quarters.", effects: { pop: -1, happy: [-3, 15], chain: ["plague_3", 4] }, result: "The smoke hangs over the city for days." } ] },
    { id: "plague_3", title: "After the Plague", trigger: "chain", needs: "plague", art: { motif: "tree", tint: "#3a5a3a" },
      text: "The Grey Cough is gone. The survivors of {city} walk the streets a little more slowly, and plant gardens where the old houses stood.",
      choices: [
        { label: "Raise a memorial and a hospital beside it.", effects: { happy: [2, 20], unflag: "plague", boost: 0.2 }, result: "The physician's name is cut in the stone above the door." },
        { label: "Throw a festival for the living.", effects: { happy: [3, 10], unflag: "plague", mood: 1 }, result: "They dance until morning, and nobody coughs." } ] },

    // ------------------------------------------------ the heretic prophet (3 steps)
    { id: "prophet_1", title: "A Voice in the Market", era: [1, 4], weight: 7, art: { motif: "flame", tint: "#6a3a2a" },
      text: "A barefoot preacher has been drawing crowds in the market of {city}. He says the old gods were invented by tax collectors, that {title} {leader} is a man like any other, and that the end of the world is due on a Thursday.",
      choices: [
        { label: "Let him speak. Listen to what he says.", effects: { flag: "prophet", chain: ["prophet_2", 6] }, result: "The crowds grow. So do the rumours." },
        { label: "Exile him beyond the frontier.", effects: { happy: [-1, 8], att: -1 }, result: "He walks into the wilds toward {rival}, still preaching." },
        { label: "Challenge him to a public debate.", trait: "scholarly", effects: { science: 40, happy: [1, 10] }, result: "The debate lasts three days. Both sides claim victory." } ] },
    { id: "prophet_2", title: "The Prophet's Following", trigger: "chain", needs: "prophet", art: { motif: "flame", tint: "#7a4a2a" },
      text: "The preacher now has ten thousand followers who call themselves the Barefoot. They refuse to pay temple taxes, sing in the streets at night, and are building a hall outside {city} with their own hands.",
      choices: [
        { label: "Embrace them. Give them the hall.", effects: { happy: [3, 20], gold: -30, chain: ["prophet_3", 10] }, result: "The Barefoot hall becomes the largest building in {city}." },
        { label: "Suppress the movement.", effects: { happy: [-2, 12], prod: 30, unflag: "prophet" }, result: "The hall is torn down. Its stones go into the city walls." } ] },
    { id: "prophet_3", title: "The New Creed", trigger: "chain", needs: "prophet", art: { motif: "scroll", tint: "#5a4a2a" },
      text: "The prophet is dead, of old age, in his bed. His followers have written down his sayings, and half of {civ} now quotes them. The temples have quietly adopted the most popular ones.",
      choices: [
        { label: "Proclaim the creed the faith of the realm.", effects: { happy: [2, 40], unflag: "prophet", flag: "creed" }, result: "The Barefoot sing at the coronation of the next {title}." },
        { label: "Keep church and crown apart.", effects: { science: 60, unflag: "prophet" }, result: "Philosophers in {capital} toast the decision for years." } ] },

    // ------------------------------------------------ diplomacy and war
    { id: "defector_1", title: "A General at the Gates", rival: true, era: [0, 6], weight: 6, cond: function (g, cid, ctx) { var r = root.PlanetDiplomacy.rel(g, cid, ctx.rival); return !!r && r.att <= 0; }, art: { motif: "sword", tint: "#5a2a2a" },
      text: "A general of {rival}, still in her armour, has ridden into {city} with forty loyal riders. She says {rivalLeader} has ordered her execution, and offers her sword to {title} {leader}.",
      choices: [
        { label: "Take her into our service.", effects: { unit: "melee", att: -2 }, result: "Her riders wear our colours by nightfall. {rival} is furious." },
        { label: "Send her back in chains.", effects: { att: 3 }, result: "{rivalLeader} sends thanks, and a cask of wine." },
        { label: "Make her a marshal of the realm.", trait: "militaristic", effects: { unit: "melee", mod: ["prod", 1, 10], att: -2 }, result: "Her drills are brutal. Our soldiers have never been sharper." } ] },
    { id: "contact_1", title: "Strangers Bearing Gifts", trigger: "contact", cooldown: 0, art: { motif: "crown", tint: "#4a5a6a" },
      text: "The first envoys of {rival} wait at the gates of {city}: painted faces, a cage of bright birds, and a gift of salt. They watch us as carefully as we watch them.",
      choices: [
        { label: "Answer gift with gift.", effects: { gold: -25, att: 2 }, result: "They leave smiling, with bolts of our finest cloth." },
        { label: "Show them our walls and our soldiers.", effects: { att: -1, happy: [1, 8] }, result: "They count our spears very carefully." },
        { label: "Open a market for them at once.", trait: "mercantile", effects: { att: 1, mod: ["gold", 1, 15] }, result: "By the next moon their traders have a street of their own." } ] },
    { id: "war_start_1", title: "Drums Along the Border", trigger: "war_start", cooldown: 20, art: { motif: "sword", tint: "#6a2a2a" },
      text: "War with {rival}. Recruiting sergeants beat their drums in every square of {city}, and the smiths have raised their prices overnight.",
      choices: [
        { label: "Call up the levies.", effects: { unit: "melee", happy: [-1, 10] }, result: "Farm boys learn which end of a spear goes forward." },
        { label: "Sell war bonds to the merchants.", effects: { gold: 80, happy: [-1, 10] }, result: "The merchants pay up, and will want it back with interest." },
        { label: "Promise glory to every soldier.", trait: "militaristic", effects: { happy: [2, 10], unit: "ranged" }, result: "Volunteers fill the barracks within a week." } ] },
    { id: "war_end_1", title: "The Long Road Home", trigger: "war_end", cooldown: 20, art: { motif: "tree", tint: "#4a5a4a" },
      text: "The war with {rival} is over. Columns of tired soldiers are walking home along every road to {capital}, some limping, all thinner than when they left.",
      choices: [
        { label: "Throw a victory parade.", effects: { gold: -30, happy: [2, 10] }, result: "Flowers, bands and free beer. The soldiers enjoy it more than they expected." },
        { label: "Grant land to the veterans.", effects: { gold: -50, mod: ["food", 1, 15] }, result: "New farms spread along the old frontier." },
        { label: "Raise a monument to the fallen.", effects: { happy: [1, 25], att: 1, mood: 1 }, result: "Both peoples' dead are named on it." } ] },
    { id: "capital_lost_1", title: "The Crown in Exile", trigger: "capital_lost", cooldown: 0, art: { motif: "crown", tint: "#3a2a2a" },
      text: "Our old capital has fallen to {rival}. The court has fled to {city} with the royal seal and very little else. In the taverns, people are asking whether {title} {leader} will ever see the old palace again.",
      choices: [
        { label: "Swear vengeance before the whole court.", effects: { mod: ["prod", 2, 12], att: -3 }, result: "Every forge in the realm turns to making weapons." },
        { label: "Rebuild here, and let the old capital go.", effects: { happy: [3, 15] }, result: "A new palace rises; it is smaller, but it is ours." } ] },
    { id: "wonder_rival_1", title: "Envy of the Age", trigger: "wonder_rival", cooldown: 30, weight: 6, art: { motif: "ruin", tint: "#6a5a2a" },
      text: "Travellers return from {rival} with stories of the {wonder}: they say it is the most beautiful thing ever made by human hands. The architects of {capital} are taking this personally.",
      choices: [
        { label: "Send artists to study it.", effects: { science: 40, att: 1 }, result: "They come back with sketchbooks and a lot of opinions." },
        { label: "Swear to build something grander.", effects: { mod: ["prod", 1, 10] }, result: "The architects of {capital} start to work late." } ] },
    { id: "wonder_own_1", title: "Pilgrims at the {wonder}", trigger: "wonder_own", cooldown: 15, art: { motif: "star", tint: "#7a6a2a" },
      text: "The {wonder} stands complete in {city}, and the roads are full of pilgrims, painters and pickpockets come to see it.",
      choices: [
        { label: "Charge a toll at the gates.", effects: { gold: 70 }, result: "The toll-keepers retire rich." },
        { label: "Welcome everyone freely.", effects: { happy: [2, 15], attAll: 1 }, result: "The {wonder} becomes famous far beyond our borders." } ] },

    // ------------------------------------------------ the lost expedition (Renaissance)
    { id: "expedition_1", title: "The Expedition That Did Not Return", trigger: "expedition", cooldown: 0, art: { motif: "ship", tint: "#2a3a5a" },
      text: "The Grand Expedition mapped a far coast, but one of its ships, the {adj} Dawn, went inland after a rumour of a city of white stone and never came back. Her captain's wife is camped outside the palace.",
      choices: [
        { label: "Send a search party.", effects: { gold: -40, flag: "lost_ship", chain: ["expedition_2", 5] }, result: "Twenty volunteers and a dog sail with the next tide." },
        { label: "Honour them as lost.", effects: { happy: [1, 10] }, result: "Their names are read in the cathedral every year." } ] },
    { id: "expedition_2", title: "Footprints in the Ice", trigger: "chain", needs: "lost_ship", art: { motif: "monolith", tint: "#5a6a7a" },
      text: "The search party found the Dawn's camp above the snow line: cold fires, a journal, and boot prints leading up toward a pass where the wind never stops. The last entry reads: 'We have seen the white city. It is not empty.'",
      choices: [
        { label: "Follow the prints over the pass.", effects: { chain: ["expedition_3", 6] }, result: "The searchers rope themselves together and climb." },
        { label: "Bring the journal home and stop here.", effects: { science: 60, unflag: "lost_ship" }, result: "The journal is printed in a hundred copies." } ] },
    { id: "expedition_3", title: "Return of the Lost", trigger: "chain", needs: "lost_ship", art: { motif: "star", tint: "#3a5a5a" },
      text: "Against all hope, the crew of the Dawn has come home — older, sunburnt, and accompanied by three strangers from the white city who speak a language no one knows, but understand our maps perfectly.",
      choices: [
        { label: "Welcome the strangers as honoured guests.", effects: { boost: 0.8, reveal: 12, unflag: "lost_ship", mood: 1 }, result: "They teach as much as they learn." },
        { label: "Ask them to guide a trade fleet back.", effects: { mod: ["gold", 2, 25], unflag: "lost_ship" }, result: "The first cargo of white-city silk sells for its weight in gold." } ] },

    // ------------------------------------------------ medieval and renaissance
    { id: "bell_1", title: "The Bell That Would Not Ring", era: [2, 3], weight: 7, art: { motif: "crown", tint: "#5a4a3a" },
      text: "The great bell cast for the cathedral of {city} is perfect in every way but one: it makes no sound. The bell-founder swears it is a curse; the bishop swears it is the bell-founder.",
      choices: [
        { label: "Melt it down and cast it again.", effects: { gold: -30, happy: [2, 12] }, result: "The second bell rings so loud it cracks a window in the palace." },
        { label: "Hang it anyway, as a silent bell.", effects: { happy: [1, 20], flag: "silent_bell" }, result: "On holy days the people stand beneath it in silence. It becomes a custom." } ] },
    { id: "alchemist_1", title: "The Alchemist's Promise", era: [2, 3], weight: 6, art: { motif: "flame", tint: "#5a3a6a" },
      text: "A soft-spoken alchemist begs an audience with {title} {leader}. With enough gold and a quiet tower, she says, she can turn lead into more gold. She has very good references.",
      choices: [
        { label: "Give her the tower and the gold.", effects: { gold: -60, science: 70 }, result: "No gold is ever made, but her notebooks found a school of chemistry." },
        { label: "Have her thrown out of the palace.", effects: { gold: 10 }, result: "She leaves a forwarding address in {rival}." } ] },
    { id: "pamphlets_1", title: "Pamphlets in the Square", era: [3, 4], weight: 8, art: { motif: "scroll", tint: "#4a4a4a" },
      text: "Every morning a new pamphlet appears in the squares of {capital}, cheaply printed and very rude. This week's shows {title} {leader} as a goat in a crown. It is selling extremely well.",
      choices: [
        { label: "Ban the printing presses.", effects: { happy: [-2, 10], mod: ["prod", 1, 10] }, result: "The presses fall silent. The jokes move to the taverns." },
        { label: "Let them print. Laugh along.", effects: { science: 50, happy: [1, 10] }, result: "The goat becomes a beloved national symbol." },
        { label: "Answer with a pamphlet of our own.", trait: "scholarly", effects: { happy: [2, 12], science: 30 }, result: "The royal reply is wittier. The printers ask for more." } ] },
    { id: "navigator_1", title: "The Navigator's Wager", era: [3, 4], weight: 7, cond: coastal, art: { motif: "ship", tint: "#2a4a6a" },
      text: "A navigator with one good eye and a map nobody else believes in asks {title} {leader} for three ships. The world is smaller than the scholars say, he insists, and there is land beyond the western sea.",
      choices: [
        { label: "Give him his ships.", effects: { gold: -70, flag: "navigator", chain: ["navigator_2", 10] }, result: "Three ships sail from {city}, and the sea swallows them." },
        { label: "Laugh him out of the court.", effects: { happy: [1, 5] }, result: "He sails for {rival} instead." } ] },
    { id: "navigator_2", title: "Land Beyond the Western Sea", trigger: "chain", needs: "navigator", art: { motif: "ship", tint: "#2a5a6a" },
      text: "Two of the three ships have come back. Their holds are full of strange seeds, bright feathers and a charted coast nobody has walked before. The navigator was right about the land, and wrong about the size of the world.",
      choices: [
        { label: "Publish the charts for all our captains.", effects: { reveal: 14, gold: 120, unflag: "navigator" }, result: "The western trade begins." },
        { label: "Plant the strange seeds.", effects: { mod: ["food", 2, 20], unflag: "navigator" }, result: "One of them turns out to be delicious." } ] },
    { id: "weavers_1", title: "The Weavers Lay Down Their Shuttles", era: [2, 4], weight: 6, cond: function (g, cid, ctx) { var c = root.PlanetGame.cityById(g, ctx.city); return !!c && c.pop >= 8; }, art: { motif: "scroll", tint: "#5a5a3a" },
      text: "The weavers' guild of {city} has gone on strike. Their looms stand idle, their banners hang from every balcony, and they want a charter, a holiday and a say in the city council.",
      choices: [
        { label: "Grant the charter.", effects: { gold: -40, mod: ["gold", 1, 20] }, result: "The guild hall becomes the richest building in {city}." },
        { label: "Break the strike.", effects: { happy: [-2, 12], prod: 40 }, result: "The looms run again. The weavers do not forget." } ] },

    // ------------------------------------------------ industrial and modern
    { id: "smog_1", title: "Black Snow", era: [4, 6], weight: 8, cond: hasB("factory"), art: { motif: "plague", tint: "#3a3a3a" },
      text: "In {city} the snow falls grey and lands black. The factory chimneys never stop, and neither does the coughing in the workers' quarter. A doctor has published a very angry pamphlet.",
      choices: [
        { label: "Fit the chimneys with filters.", effects: { gold: -60, happy: [2, 15] }, result: "The snow is white again, mostly." },
        { label: "Production comes first.", effects: { mod: ["prod", 1, 10], happy: [-2, 15] }, result: "The chimneys keep smoking." } ] },
    { id: "rail_1", title: "Railway Fever", era: [4, 5], weight: 8, art: { motif: "sword", tint: "#4a3a2a" },
      text: "Everyone in {capital} is buying railway shares. Lines are planned to towns that do not exist yet, and a clerk in {city} has become a millionaire on paper. The finance minister looks pale.",
      choices: [
        { label: "Invest the treasury in the railways.", effects: { gold: -100, mod: ["prod", 2, 15] }, result: "The rails go down faster than anyone thought possible." },
        { label: "Cool the market before it crashes.", effects: { happy: [-1, 8], gold: 60 }, result: "Shares fall. The treasury, wisely, sold first." } ] },
    { id: "strike_1", title: "The General Strike", era: [4, 6], weight: 6, art: { motif: "flame", tint: "#6a3a3a" },
      text: "Every factory, dock and mine in {civ} has stopped at the same hour. The unions' demands fit on a single page: shorter days, safer machines, and a vote for everyone over twenty.",
      choices: [
        { label: "Accept the page.", effects: { gold: -50, happy: [3, 25], mood: 1 }, result: "The factories restart the next morning, singing." },
        { label: "Send in the police.", effects: { happy: [-3, 15], prod: 50 }, result: "The strike breaks. The bitterness lasts a generation." } ] },
    { id: "radio_1", title: "Voices on the Air", era: [5, 6], weight: 8, rival: true, art: { motif: "star", tint: "#2a3a5a" },
      text: "The new radio towers of {capital} can reach every home in the realm, and the homes of {rival} too. The ministry wants to know what we should say with them.",
      choices: [
        { label: "Broadcast {title} {leader}'s fireside talks.", effects: { happy: [2, 20] }, result: "The whole country listens at the same hour every week." },
        { label: "Broadcast into {rival} as well.", effects: { happy: [1, 10], att: -2, science: 40 }, result: "{rivalLeader} denounces our 'airborne lies'." },
        { label: "Share the airwaves with scholars.", trait: "scholarly", effects: { science: 120 }, result: "A generation of children grows up on lectures." } ] },
    { id: "atom_1", title: "The Split Atom", era: [5, 7], weight: 9, art: { motif: "eye", tint: "#2a5a4a" },
      text: "In a basement laboratory beneath the university of {capital}, a team of physicists has split the atom. They are terrified, delighted, and very much in need of funding.",
      choices: [
        { label: "Build reactors: power for every city.", effects: { gold: -80, mod: ["prod", 2, 30] }, result: "The lights of {civ} burn all night." },
        { label: "Build weapons.", effects: { unit: "ranged", attAll: -1 }, result: "The neighbours notice. They always do." },
        { label: "Publish everything, for every nation.", trait: "scholarly", effects: { science: 150, attAll: 2 }, result: "A Nobel committee is invented just to give them a prize." } ] },
    { id: "network_1", title: "The Everything Machine", era: [6, 7], weight: 8, art: { motif: "eye", tint: "#2a3a4a" },
      text: "Ninety percent of the households in {civ} now own a machine that knows more than any library ever did. Productivity is up, sleep is down, and nobody can agree on what is true any more.",
      choices: [
        { label: "Fund public libraries online.", effects: { gold: -80, mod: ["sci", 2, 20] }, result: "Every child in {city} learns to code." },
        { label: "Regulate the machines.", effects: { happy: [2, 15] }, result: "The machines are told to be kind. Mostly they are." } ] },

    // ------------------------------------------------ space age and the long now
    { id: "orbit_1", title: "First Light from Orbit", era: [6, 7], weight: 10, cond: function (g, cid) { return root.PlanetEras && root.PlanetEras.projectDone(g, cid, "orbital_satellite") != null; }, art: { motif: "star", tint: "#101a3a" },
      text: "The first photograph of our whole world has come back from the satellite. It shows a blue and green ball, very small, very alone, with no borders on it at all. It is on the front page of every newspaper in {civ} and {rival}.",
      choices: [
        { label: "Send copies to every nation we know.", effects: { attAll: 2, happy: [2, 15] }, result: "Diplomats find themselves strangely quiet in meetings." },
        { label: "Hang it in every school.", effects: { science: 150 }, result: "A generation grows up thinking of the planet as one place." } ] },
    { id: "launch_1", title: "The Stars Are Open", trigger: "launch", cooldown: 0, notable: true, art: { motif: "star", tint: "#0a1030" },
      text: "On a clear night in {year}, the Colony Ship lifted from {city} on a pillar of light. Everyone in {civ} watched it go. Somewhere out there, beyond the strange star our ancestors painted in a buried hall, the next chapter of the {people} has begun.",
      choices: [
        { label: "Name the ship after {title} {leader}.", effects: { happy: [4, 30], flag: "launched" }, result: "The ship carries the leader's name toward the stars." },
        { label: "Name it after {capital}, where we began.", effects: { happy: [4, 30], flag: "launched", mood: 1 }, result: "The old town's name will be the first word spoken in a new world." } ] },
    { id: "signal_1", title: "A Signal from Beyond", era: [7, 7], weight: 10, needs: "launched", art: { motif: "eye", tint: "#0a0a2a" },
      text: "The deep-space array outside {capital} has picked up a repeating pattern from a point near the colony ship's course. Rising tones, never repeated. An old archivist says it sounds exactly like a humming stone her grandmother once described.",
      choices: [
        { label: "Answer it.", effects: { flag: "answered", science: 200 }, result: "We send the pattern back. The galaxy is quiet, and then it is not." },
        { label: "Listen, and wait.", effects: { flag: "listening", happy: [2, 20] }, result: "The array listens. Whatever is out there, it is patient too." } ] },
    { id: "founders_tomb_1", title: "The Founders' Tomb", era: [3, 7], weight: 5, art: { motif: "ruin", tint: "#4a3a2a" },
      text: "Road builders near {capital} have broken into a tomb older than the city: the grave of the first chief of the {people}, buried with a clay map of the river and a single bronze star.",
      choices: [
        { label: "Rebury the founder with honours.", effects: { happy: [3, 20], mood: 1 }, result: "The procession is the longest in living memory." },
        { label: "Put the tomb in the national museum.", effects: { science: 90, gold: 40 }, result: "School children press their noses to the glass." } ] },
    { id: "old_calendar_1", title: "The Old Calendar", turns: [120, 9999], weight: 4, art: { motif: "scroll", tint: "#4a4a3a" },
      text: "Historians in {capital} have worked out that it is now {year} by the old reckoning, a round and auspicious number if you squint. The priests want a jubilee; the treasury wants a word.",
      choices: [
        { label: "Proclaim a jubilee.", effects: { gold: -60, happy: [3, 10] }, result: "Debts are forgiven and bells are rung." },
        { label: "Reform the calendar instead.", effects: { science: 60 }, result: "The new calendar is more accurate and nobody likes it." } ] },

    // ------------------------------------------------ ages
    { id: "golden_1", title: "An Age of Gold", trigger: "golden", cooldown: 30, art: { motif: "star", tint: "#7a6a2a" },
      text: "These are the good years. The harvests are heavy, the roads are safe and the young people of {civ} talk about the future as if it were a place they could walk to.",
      choices: [
        { label: "Commission great works of art.", effects: { gold: -50, happy: [2, 20] }, result: "Sculptors from {rival} come to work in {capital}." },
        { label: "Invest in learning.", effects: { mod: ["sci", 1, 15] }, result: "New schools open in every city." } ] },
    { id: "dark_1", title: "The Grey Years", trigger: "dark", cooldown: 30, art: { motif: "plague", tint: "#2a2a3a" },
      text: "A heaviness has settled over {civ}. People leave the cities for the countryside, the markets thin out, and the old songs about better days are sung everywhere.",
      choices: [
        { label: "Open the treasury for public works.", effects: { gold: -60, happy: [3, 10] }, result: "Bridges and fountains go up, and with them a little hope." },
        { label: "Endure. It will pass.", effects: { mod: ["food", 1, 8] }, result: "It does pass, slowly." } ] }
  ];

  root.PlanetStoryData = { EVENTS: EVENTS };
})(typeof window !== "undefined" ? window : globalThis);
