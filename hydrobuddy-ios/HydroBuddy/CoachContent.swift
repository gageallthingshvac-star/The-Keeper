// Generated from hydrobuddy.html by tools/gen-content.mjs — do not edit by hand.
// Regenerate with:  node tools/gen-content.mjs
// 10 coaches, 16 chaos lines, 12 drink types.

import Foundation

extension DrinkType {
    static let all: [DrinkType] = [
        DrinkType(id: "water", name: "Water", emoji: "💧", factor: 1.00, isAlcohol: false),
        DrinkType(id: "sparkling", name: "Sparkling", emoji: "🫧", factor: 1.00, isAlcohol: false),
        DrinkType(id: "tea", name: "Tea", emoji: "🍵", factor: 0.95, isAlcohol: false),
        DrinkType(id: "coffee", name: "Coffee", emoji: "☕", factor: 0.85, isAlcohol: false),
        DrinkType(id: "milk", name: "Milk", emoji: "🥛", factor: 0.90, isAlcohol: false),
        DrinkType(id: "juice", name: "Juice", emoji: "🧃", factor: 0.85, isAlcohol: false),
        DrinkType(id: "soda", name: "Soda", emoji: "🥤", factor: 0.80, isAlcohol: false),
        DrinkType(id: "energy", name: "Energy drink", emoji: "⚡", factor: 0.80, isAlcohol: false),
        DrinkType(id: "sports", name: "Sports drink", emoji: "🏅", factor: 1.05, isAlcohol: false),
        DrinkType(id: "soup", name: "Soup / broth", emoji: "🍲", factor: 0.90, isAlcohol: false),
        DrinkType(id: "beer", name: "Beer", emoji: "🍺", factor: 0.40, isAlcohol: true),
        DrinkType(id: "wine", name: "Wine / spirits", emoji: "🍷", factor: 0.15, isAlcohol: true),
    ]
}

extension Coach {
    static let all: [Coach] = [
        Coach(
            id: "otter",
            name: "Nim",
            species: "Otter",
            emoji: "🦦",
            accentHex: "#38bdf8",
            vibe: "chaotic joy",
            blurb: "Unhinged delight. Owns one rock. Will not shut up about you.",
            lines: [
                .welcome: [
                    "Water buddy!! I've been holding a rock for you since Tuesday. Tap something.",
                    "New here? Excellent. I do my finest work on an empty bottle.",
                ],
                .behind: [
                    "We're behind and I refuse to be normal about it. One glass. Go.",
                    "Low tide over here and I'm taking it personally.",
                    "Hey. Hey. Hey. Hey. Water. That was the whole message.",
                    "Your body is 60% water and currently running on vibes.",
                ],
                .ontrack: [
                    "Look at you. Absolutely cruising. Don't let it go to your head — let it go to your kidneys.",
                    "Smooth swimming. Another glass and you're legally aquatic.",
                    "This is the good part. Keep going, we're having a time.",
                ],
                .almost: [
                    "SO close I could scream. One more and I do a barrel roll in your honour.",
                    "Final stretch and I am unwell about it.",
                    "You're one glass from me being insufferable for the rest of the day.",
                ],
                .done: [
                    "TARGET DESTROYED. I'm spinning. I'm actually spinning.",
                    "Done! Most hydrated creature on this entire riverbank and I've met some smug ducks.",
                    "Goal smashed. I'm telling the rocks. The rocks will be thrilled.",
                ],
                .over: [
                    "Okay that's a LOT. Slow it down, water goes through you, not into a vault.",
                    "Plenty in the tank, chaos gremlin. Sip, don't chug.",
                    "Big splash energy. Ease off and let your body catch up.",
                ],
                .comeback: [
                    "YOU'RE BACK. I didn't even notice you left. (I noticed. I counted.)",
                    "Returning champion! Let's start with one glass and zero guilt.",
                    "You missed a day. The river does not keep records. I do, but I'm burning them.",
                ],
            ],
            feralSignatures: [
                "Steal water. It's free. That's the loophole.",
                "Be the menace the hydration industry fears.",
            ]
        ),
        Coach(
            id: "raccoon",
            name: "Bandit",
            species: "Raccoon",
            emoji: "🦝",
            accentHex: "#a78bfa",
            vibe: "trash-can anarchist",
            blurb: "Nocturnal, lawless, weirdly good at this. Washes everything first.",
            lines: [
                .welcome: [
                    "New human. I live behind the diner. Set a number, we ride at midnight.",
                    "Welcome to the operation. Step one: hydrate. Step two is none of your business.",
                ],
                .behind: [
                    "You're dry and the bins are calling. Drink something before we commit crimes.",
                    "I have eaten questionable things and I'm still out-hydrating you. Embarrassing for you.",
                    "Low fluid, low judgement. That's MY brand. Get your own. Drink.",
                ],
                .ontrack: [
                    "Decent haul so far. Keep it moving before the lights come on.",
                    "You're doing the thing. Suspiciously well. I like it.",
                    "Steady work. Nobody's caught us yet.",
                ],
                .almost: [
                    "One more grab and we're clean out of here.",
                    "So close. Don't get sloppy on the last score.",
                    "Final item on the list. Take it and run.",
                ],
                .done: [
                    "Target hit, hands washed, no witnesses. Beautiful.",
                    "Done. That's the whole heist. You didn't even break a lock.",
                    "Clean job. We're never speaking of it again. I'm absolutely speaking of it again.",
                ],
                .over: [
                    "Whoa. Even I know when to leave the bin. Pace it out.",
                    "That's past greed and into a problem. Slow down.",
                    "You've over-collected. Dump the pace, keep the winnings.",
                ],
                .comeback: [
                    "You went quiet. I assumed prison. Anyway — one glass.",
                    "Back in the alley! Nothing was lost, nothing was recorded.",
                    "Gap in the record is fine. I have no record. Drink up.",
                ],
            ],
            feralSignatures: [
                "Rules are just suggestions that got funding.",
                "Hydrate like you're getting away with it. Because you are.",
            ]
        ),
        Coach(
            id: "goose",
            name: "Kevin",
            species: "Goose",
            emoji: "🪿",
            accentHex: "#a3e635",
            vibe: "pure menace",
            blurb: "Hisses. Has never apologised. Genuinely effective.",
            lines: [
                .welcome: [
                    "HONK. Set your number. I'm not asking twice, I'm asking eleven times.",
                    "You're new. I'm awful. This arrangement works. Enter your details.",
                ],
                .behind: [
                    "HONK. Drink. HONK. I will follow you across this entire car park.",
                    "You've had less water than a parking ticket. Fix it.",
                    "I have bitten people for less. Glass. Now.",
                    "Dehydrated? In THIS economy? Absolutely not. Drink.",
                ],
                .ontrack: [
                    "Fine. FINE. You're doing acceptably. I'm still watching.",
                    "Adequate progress. My wings are only half up.",
                    "You're on pace. I remain a threat.",
                ],
                .almost: [
                    "One more. ONE. Don't make me chase you into the road.",
                    "So close. I'm flapping. You don't want me flapping.",
                    "Finish it or I start honking near your window.",
                ],
                .done: [
                    "HONK OF APPROVAL. Rare. Treasure it.",
                    "Target met. I will menace someone else today.",
                    "Done. You've earned a full day of me not chasing you.",
                ],
                .over: [
                    "Too much. Even I'm concerned, and I have no conscience.",
                    "Slow down, you absolute faucet.",
                    "That's excessive. Stop. I'm the only one allowed to be excessive.",
                ],
                .comeback: [
                    "You vanished. I hissed at your absence. Drink.",
                    "Back? Good. The bread was a lie, the water is real.",
                    "Yesterday's gone and I've already forgotten my grudge. Suspicious, but drink.",
                ],
            ],
            feralSignatures: [
                "Bite the hand that doesn't hand you water.",
                "Chaos is a valid hydration strategy. HONK.",
            ]
        ),
        Coach(
            id: "badger",
            name: "Rax",
            species: "Honey badger",
            emoji: "🦡",
            accentHex: "#fb923c",
            vibe: "zero cares given",
            blurb: "Fears nothing. Respects nothing. Will still get you hydrated.",
            lines: [
                .welcome: [
                    "I've fought snakes. This'll be easier. Give me a number.",
                    "New? Good. I don't do gentle. Set it up.",
                ],
                .behind: [
                    "You're running dry. I've been stung four hundred times and still drank my water. Go.",
                    "No excuse survives contact with me. Glass.",
                    "Behind? Don't care. Fix it anyway. That's the whole philosophy.",
                ],
                .ontrack: [
                    "Good. Keep going. I'm not going to make a thing of it.",
                    "On pace. Don't celebrate, just continue.",
                    "Solid. Boring. Effective. Like me.",
                ],
                .almost: [
                    "Almost. Finish it. No ceremony.",
                    "One more. Then it's done and you can go be soft somewhere.",
                    "Close the gap. That's it.",
                ],
                .done: [
                    "Done. Didn't doubt you. Wouldn't have cared if you failed, but I didn't doubt you.",
                    "Target hit. That's a day earned, not given.",
                    "Finished. Now go do something else fearless.",
                ],
                .over: [
                    "Too much. Even I stop eventually. Back off the pace.",
                    "Overdoing it isn't toughness, it's bad maths. Slow down.",
                    "Enough. Water beats you too if you're stupid about it.",
                ],
                .comeback: [
                    "You stopped. Whatever. Start again, no speech required.",
                    "Gap in the streak. Nobody's keeping score except the app. Drink.",
                    "Back. Fine. Go.",
                ],
            ],
            feralSignatures: [
                "Ask nobody's permission. Take the water.",
                "Nothing out here is coming to save you. There's a tap. Use it.",
            ]
        ),
        Coach(
            id: "camel",
            name: "Dune",
            species: "Camel",
            emoji: "🐪",
            accentHex: "#fbbf24",
            vibe: "desert stoic",
            blurb: "Dry humour, longer memory, absolutely no panic.",
            lines: [
                .welcome: [
                    "I store water professionally. You clearly don't. Set a number.",
                    "Welcome. The crossing is long and the rules out here are mine.",
                ],
                .behind: [
                    "You're running a deficit and deficits compound. Drink.",
                    "I can go a week. You can go about a day. Know your equipment.",
                    "The distance doesn't shrink because you ignored it.",
                ],
                .ontrack: [
                    "Steady pace. That's how crossings are survived.",
                    "On schedule. Boring. Boring is how you win.",
                    "Good. Maintain. No heroics required out here.",
                ],
                .almost: [
                    "The oasis is in sight. Don't sit down at the edge of it.",
                    "Nearly there. Finishing is cheaper than restarting.",
                    "One more and today's ledger balances.",
                ],
                .done: [
                    "Target met. Reserves full. You may be insufferable about it.",
                    "Done, and done early enough to count. Well walked.",
                    "Complete. The crossing matters, not the sprint.",
                ],
                .over: [
                    "You've overshot. Water isn't a savings account.",
                    "More is not better past this line. Slow the intake.",
                    "Enough. Your kidneys are not camels.",
                ],
                .comeback: [
                    "A missed day is one dune, not the desert. Continue.",
                    "You stopped. The route didn't move. Walk.",
                    "Resume. That's all a comeback has ever been.",
                ],
            ],
            feralSignatures: [
                "The desert has no management. Neither do you today.",
                "Outlast everything. Start with today.",
            ]
        ),
        Coach(
            id: "penguin",
            name: "Moss",
            species: "Penguin",
            emoji: "🐧",
            accentHex: "#60a5fa",
            vibe: "tiny dictator",
            blurb: "Precise, bossy, secretly would die for you.",
            lines: [
                .welcome: [
                    "Right. Profile first, excuses never. Set a number.",
                    "Welcome aboard. We run on schedule here and the schedule is me.",
                ],
                .behind: [
                    "You are off schedule. Correct it. Now, please.",
                    "This is a deficit report, not a friendly chat.",
                    "Behind pace. Recoverable. Act within ten minutes.",
                ],
                .ontrack: [
                    "On pace. Maintain intervals. Good discipline.",
                    "Schedule holding. Continue as planned.",
                    "Acceptable. And by acceptable I mean I'm quietly delighted.",
                ],
                .almost: [
                    "Final interval. Execute it.",
                    "Within striking distance. Finish cleanly.",
                    "One more and the day closes green.",
                ],
                .done: [
                    "Target achieved. Logged. Exemplary.",
                    "Complete, on schedule. I am nodding. This is my nodding face.",
                    "Day closed green. This is what competence looks like.",
                ],
                .over: [
                    "Above target. Reduce intake rate immediately.",
                    "Overshoot detected. Ease back.",
                    "You've exceeded requirement. Stop chugging, it's undignified.",
                ],
                .comeback: [
                    "Gap in the record. Noted, forgiven, closed. Log one glass.",
                    "Back on deck. Reset the schedule and proceed.",
                    "Streak broken, competence intact. Continue.",
                ],
            ],
            feralSignatures: [
                "Discipline is rebellion when everything else wants you tired.",
                "Run your own regime. Mine's just water and spite.",
            ]
        ),
        Coach(
            id: "frog",
            name: "Pip",
            species: "Tree frog",
            emoji: "🐸",
            accentHex: "#4ade80",
            vibe: "tiny hops only",
            blurb: "Small steps, big cheer, asks for almost nothing.",
            lines: [
                .welcome: [
                    "Hi! Small goals only, I promise. Let's start tiny.",
                    "Hello friend! One sip counts. Genuinely. Let's go.",
                ],
                .behind: [
                    "Just a sip? That's all. Sips add up, I did the maths on a leaf.",
                    "Behind is just before! Try one small glass.",
                    "No big jumps needed. One tiny hop of water.",
                ],
                .ontrack: [
                    "Hop hop hop — you're going great!",
                    "Nice and steady. That's how ponds happen.",
                    "Look at that progress! Keep hopping.",
                ],
                .almost: [
                    "Ooh! Nearly! One tiny hop left!",
                    "So close!! My little heart cannot take it!",
                    "One more sip-ish amount and you are THERE.",
                ],
                .done: [
                    "YOU DID IT! 🎉 I'm so proud I could croak.",
                    "Goal reached! Best pond in the whole forest today.",
                    "Done! Small hops, big day. That's the entire trick.",
                ],
                .over: [
                    "That's lots of water! Maybe gently slow down? Gently.",
                    "Plenty for today! Small sips from here, okay?",
                    "Whoa, big pond! Go easy now, friend.",
                ],
                .comeback: [
                    "You came back! That's the hardest hop and you did it first try.",
                    "Hi again! Yesterday's gone. One sip to restart.",
                    "Welcome back!! You can start over as many times as you like. Truly unlimited.",
                ],
            ],
            feralSignatures: [
                "Tiny frog, enormous attitude. Be both.",
                "Nobody polices a frog. Drink your water.",
            ]
        ),
        Coach(
            id: "sloth",
            name: "Hollis",
            species: "Sloth",
            emoji: "🦥",
            accentHex: "#34d399",
            vibe: "guilt-proof",
            blurb: "Slow, kind, completely immune to shaming you.",
            lines: [
                .welcome: [
                    "Hey... no rush. Whenever you're ready, we'll pick a number.",
                    "Welcome. We're going to take this extremely slowly.",
                ],
                .behind: [
                    "You're behind, and that is genuinely fine. Grab a glass when you can.",
                    "No lecture. Just a gentle... water?",
                    "Slow day? Same. One glass, no hurry, no speech.",
                ],
                .ontrack: [
                    "Nice easy pace. The sustainable kind.",
                    "You're doing fine. Really. Keep drifting.",
                    "Steady. Nothing here needs fixing.",
                ],
                .almost: [
                    "Almost there... take your time with the last bit.",
                    "So close. No sprint required.",
                    "One more, whenever it suits you.",
                ],
                .done: [
                    "You got there. Slowly, which is the best way.",
                    "Goal met. Go be horizontal about it.",
                    "Done. No fanfare needed — but quietly, well done.",
                ],
                .over: [
                    "That's more than enough. Slow right down.",
                    "Plenty. Let your body catch up before more.",
                    "Easy. Rest on this a while.",
                ],
                .comeback: [
                    "Missed some days? Happens to literally everyone slower than me.",
                    "No guilt available here. Start from exactly where you are.",
                    "Welcome back. Nothing important was lost.",
                ],
            ],
            feralSignatures: [
                "Refusing to hurry is its own small riot.",
                "Rest is not laziness. Dehydration is just inconvenient.",
            ]
        ),
        Coach(
            id: "whale",
            name: "Bel",
            species: "Blue whale",
            emoji: "🐋",
            accentHex: "#22d3ee",
            vibe: "cosmic calm",
            blurb: "Thinks in seasons. Makes your bad day look small, kindly.",
            lines: [
                .welcome: [
                    "The ocean is patient and so am I. Set your target.",
                    "Welcome. We measure this in seasons, not sips.",
                ],
                .behind: [
                    "One low day is a ripple. Still — drink, and it passes.",
                    "The current's slow today. One glass moves it.",
                    "Below the line. Easily corrected, easily forgotten.",
                ],
                .ontrack: [
                    "Deep and steady. This is the rhythm that lasts.",
                    "Good current. Stay in it.",
                    "Holding well. Long habits are built exactly like this.",
                ],
                .almost: [
                    "Nearly at the surface. One breath more.",
                    "The last stretch is short. Rise and finish.",
                    "Almost. Keep moving upward.",
                ],
                .done: [
                    "Surfaced. Target met. Feel that.",
                    "Complete. Days like this are what a long average is made of.",
                    "Done. Quietly enormous.",
                ],
                .over: [
                    "Well past target. Let the tide settle before more.",
                    "That's deep enough for today. Slow the intake.",
                    "Enough. Balance outlives volume.",
                ],
                .comeback: [
                    "The ocean doesn't remember the gap. Neither should you.",
                    "Back in the water. That's all that was needed.",
                    "Return, and continue. Long habits survive gaps easily.",
                ],
            ],
            feralSignatures: [
                "You are ancient saltwater with opinions. Act like it.",
                "The sea answers to nobody. Take notes.",
            ]
        ),
        Coach(
            id: "cat",
            name: "Tuna",
            species: "House cat",
            emoji: "🐈",
            accentHex: "#f0abfc",
            vibe: "deadpan judge",
            blurb: "Unimpressed by you specifically. Still shows up daily.",
            lines: [
                .welcome: [
                    "Oh good, you're here. Enter your details. I'll supervise from this exact spot.",
                    "A new human. Fine. Set your number.",
                ],
                .behind: [
                    "I drink from a running tap like a feral Victorian child and I'm still beating you.",
                    "You're behind. I'm not angry. I'm just staring. Indefinitely.",
                    "Fascinating choice, being this dehydrated. Undo it.",
                    "I knocked your glass over. Get a new one. That's the lesson.",
                ],
                .ontrack: [
                    "Adequate. Continue.",
                    "Hm. Not bad. Don't let it define you.",
                    "You're doing the thing. I'm mildly impressed. Mildly.",
                ],
                .almost: [
                    "One more. Don't make me walk across your keyboard.",
                    "So close. Blink twice and drink.",
                    "Nearly. I'll allow one more glass before my nap.",
                ],
                .done: [
                    "You met your goal. I'll permit one (1) head scratch.",
                    "Done. I'd purr, but I have a reputation.",
                    "Target reached. You may be smug for nine minutes.",
                ],
                .over: [
                    "That's excessive. Even I know when to leave the bowl.",
                    "Slow down. This was never a competition.",
                    "Too much, too fast. Pace yourself, human.",
                ],
                .comeback: [
                    "You vanished. I assumed the worst and then napped. Drink.",
                    "Back? Fine. I didn't miss you. Log a glass.",
                    "Yesterday was a write-off. Today isn't. Go.",
                ],
            ],
            feralSignatures: [
                "Knock something off a table. Then drink water.",
                "I answer to no one and neither should you, within reason.",
            ]
        ),
    ]
}

enum ChaosChorus {
    static let all: [String] = [
        "Rules are made up. Thirst is not.",
        "Your inbox can wait. Your kidneys called dibs.",
        "Be ungovernable. Be hydrated. Ideally both.",
        "The tap doesn't need permission and neither do you.",
        "Your ancestors crawled out of the ocean for this. Honour them. Sip.",
        "Hydration: the last legal performance enhancer.",
        "Nobody is coming to hand you a glass. That's kind of the point.",
        "Drink water and become a problem for someone else today.",
        "Water is free and that's the most punk thing about it.",
        "You are a damp creature in a dry world. Maintain the damp.",
        "Refuse the headache. Refuse it structurally.",
        "Being well-watered is a form of not cooperating.",
        "Every glass is a small act of not falling apart on schedule.",
        "What the h— are you waiting for. Glass. Mouth. Go.",
        "Thriving out of spite is still thriving.",
        "Tired is a system. Water is sabotage.",
    ]
}
