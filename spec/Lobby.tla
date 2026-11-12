---------------------------- MODULE Lobby ----------------------------
(* fh-coop ready-up lobby (0.1.18): the room (room.js, on the host's PC) and each player's
   title screen (client/lobby.js).

   His rules (11/08): Start only when every person present is ready; someone idle five
   minutes at the title is "away" and does not block; new-run characters are picked in the
   lobby; late joining stays.
   Mine: Start calls everyone ready in at once; while the host is called only the host's
   game founds the run; someone the lobby has called holds their character from the call
   on; an AI partner comes in after the people and never founds a run.

   What is modelled beside the lobby itself, because the holes are at the seams: a game
   begun with no lobby on screen (alone, the host away, or the line down), a line that
   drops while the page plays on and comes back, a start called off, a run that ends under
   someone on the way in.

   Not modelled (assumed): the host's save is one they are alive in (a dead host waits for a
   living player and someone else founds, room.js worldwait); a page told to start does
   start as what the lobby said (client/lobby.js begin); a title menu never acts on a lobby
   message still in flight (a 100 ms window, client/lobby.js tick); what a page does by itself
   while its line is down and its call held (back to the title, a game of its own) is as if the
   hold had ended first: the room cannot tell until the page is back, and then drops the hold
   (room.js 'name': not "called"); one page per name (another tab taking a held name ends
   the hold, and the first page is then refused the name: room.js nametaken). *)
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Host, Joiners, Partner, Chars, NoChar,
          HostSave, JoinerSave,   \* the character each one's own save of the run is
          AnySave                 \* TRUE: a save may be any character (trace validation)

People == {Host} \cup Joiners
Actors == People \cup {Partner}
SaveOpts(x) == IF AnySave THEN Chars ELSE {IF x = Host THEN HostSave ELSE JoinerSave}
JoinerPerms == Permutations(Joiners)   \* the joiners are alike (safety runs only)

VARIABLES conn,      \* actor -> its line to the room is up (the partner: its process runs)
          at,        \* actor -> "title" | "loading" (a game runs on the page, not in the run)
                     \*          | "off" (loading, and its start was called off) | "in"
          ready,     \* person -> ready (the host never readies: Start is theirs)
          away,      \* person -> idle five minutes at the title
          pick,      \* person -> character picked in the lobby, or NoChar
          has,       \* person -> the character of their own save, as their page told the room
          run,       \* what this night is: "none" | "new" | "save"
          line,      \* people called in and not in yet (room.lobby.line); one whose line is down
                     \* is held (room.lobby.held): the call and the character are kept for them
          founded,   \* the room has a run (room.founded)
          body,      \* actor -> the character the game on their page is, or NoChar
          entered    \* people who have been in the run under way (room.entered)

vars == <<conn, at, ready, away, pick, has, run, line, founded, body, entered>>

Here == {x \in People : conn[x]}
In == {x \in Actors : at[x] = "in"}
\* The run someone at the title would come into (room.js lobbyRun): whoever has been in the
\* run under way cannot load their save into it, and comes in as someone new.
KindFor(x) == IF founded /\ x \in entered THEN "new" ELSE run
\* What someone would come in as (room.js lobbyChar): their pick, else their own save.
CharOf(x) == IF pick[x] # NoChar THEN pick[x] ELSE IF KindFor(x) = "save" THEN has[x] ELSE NoChar
\* Spoken for at the title: the host's character and every ready person's.
Claimed(x) == {CharOf(y) : y \in {z \in Here \ {x} : z = Host \/ ready[z]}}
\* Taken in the run (room.js lobbyBusy): whoever is in it, and whoever has been called.
Busy == {body[y] : y \in In} \cup {CharOf(y) : y \in line}
\* The lobby is on screen (room.js lobbyTell "on"): the title menu is the lobby's, not the game's.
LobbyOn == Cardinality(Here) >= 2 /\ (founded \/ conn[Host])

TypeOK ==
    /\ conn \in [Actors -> BOOLEAN]
    /\ at \in [Actors -> {"title", "loading", "off", "in"}]
    /\ ready \in [People -> BOOLEAN]
    /\ away \in [People -> BOOLEAN]
    /\ pick \in [People -> Chars \cup {NoChar}]
    /\ has \in [People -> Chars \cup {NoChar}]
    /\ run \in {"none", "new", "save"}
    /\ line \in SUBSET People
    /\ founded \in BOOLEAN
    /\ body \in [Actors -> Chars \cup {NoChar}]
    /\ entered \in SUBSET People

Init ==
    /\ conn = [x \in Actors |-> FALSE]
    /\ at = [x \in Actors |-> "title"]
    /\ ready = [x \in People |-> FALSE]
    /\ away = [x \in People |-> FALSE]
    /\ pick = [x \in People |-> NoChar]
    /\ has = [x \in People |-> NoChar]
    /\ run = "none"
    /\ line = {}
    /\ founded = FALSE
    /\ body = [x \in Actors |-> NoChar]
    /\ entered = {}

\* mutate:begin
\* A person's page reaches the room, or the host calls the partner in (room.js 'name';
\* F8 and maybeRecall start the partner's process). A page whose line was down may have a
\* game running: it comes back as it is. Someone held comes back to their call only with
\* that game still running (client/net.js Coop.called); otherwise the hold ends first.
Connect(x) ==
    /\ ~conn[x]
    /\ x \in line => at[x] = "loading"
    /\ conn' = [conn EXCEPT ![x] = TRUE]
    /\ UNCHANGED <<at, ready, away, pick, has, run, line, founded, body, entered>>

\* A line drops or a page closes (room.js drop -> leaveWorld, lobbyGone). The room forgets
\* what they said in the lobby (peer.lob goes with the peer), unless they were called: then
\* the call and the character are held for them (lobby.held). keep: the page plays on with
\* its line down. The last one in dropping ends the run (leaveWorld -> lobbyReset); the host
\* dropping before the run exists calls the start off and clears the lobby (lobbyGone ->
\* lobbyReset). Either way whoever was called, loading and here is called off (calledOff);
\* someone held is simply no longer called (the room has no page to tell).
Drop(x) ==
    /\ conn[x]
    /\ conn' = [conn EXCEPT ![x] = FALSE]
    /\ away' = [y \in People |-> away[y] /\ y # x]
    /\ LET lost == founded /\ In = {x}
           cancel == x = Host /\ ~founded
           clear == lost \/ cancel
           held == ~clear /\ x \in line
       IN /\ founded' = (founded /\ ~lost)
          /\ line' = IF clear THEN {} ELSE line
          /\ run' = IF clear THEN "none" ELSE run
          /\ pick' = [y \in People |-> IF clear \/ (y = x /\ ~held) THEN NoChar ELSE pick[y]]
          /\ has' = [y \in People |-> IF clear \/ (y = x /\ ~held) THEN NoChar ELSE has[y]]
          /\ ready' = [y \in People |-> ready[y] /\ ~clear /\ y # x]
          /\ \E keep \in BOOLEAN :
                /\ keep => (x \in People /\ at[x] # "title")
                /\ at' = [y \in Actors |-> IF y = x THEN (IF keep THEN "loading" ELSE "title")
                                           ELSE IF clear /\ y \in line /\ conn[y] /\ at[y] = "loading" THEN "off"
                                           ELSE at[y]]
                /\ body' = [body EXCEPT ![x] = IF keep THEN @ ELSE NoChar]
    /\ UNCHANGED entered

\* Nobody came back for a held call in time, or whoever did is not that game (room.js
\* holdEnds: LINE_HOLD, 'name'): the call is dropped and the character free.
HoldEnds(x) ==
    /\ x \in line
    /\ ~conn[x]
    /\ line' = line \ {x}
    /\ pick' = [pick EXCEPT ![x] = NoChar]
    /\ has' = [has EXCEPT ![x] = NoChar]
    /\ UNCHANGED <<conn, at, ready, away, run, founded, body, entered>>

\* The host says what this night is: a new run as a character, one of their saves, or
\* nothing yet ("Change run"). Nobody stays ready and no pick stays: what each person would
\* load just changed (room.js lobbySay 'run' -> lobbyReset).
ChooseRun(r, c) ==
    /\ r \in {"none", "new", "save"}
    /\ conn[Host]
    /\ at[Host] = "title"
    /\ ~founded
    /\ line = {}
    /\ r = "none" => c = NoChar
    /\ r = "new" => c \in Chars
    /\ r = "save" => c \in SaveOpts(Host)
    /\ run' = r
    /\ ready' = [x \in People |-> FALSE]
    /\ pick' = [x \in People |-> IF x = Host /\ r = "new" THEN c ELSE NoChar]
    /\ has' = [x \in People |-> IF x = Host /\ r = "save" THEN c ELSE NoChar]
    /\ UNCHANGED <<conn, at, away, line, founded, body, entered>>

\* A page tells the room which character its own save of the run is (room.js lobbySay
\* 'has'). Ready given for the other one does not stand. The host carrying a save on is
\* who the save they chose is.
Has(x, c) ==
    /\ x \in People
    /\ conn[x]
    /\ c \in SaveOpts(x) \cup {NoChar}
    /\ c # has[x]
    /\ at[x] # "in"
    /\ x \notin line
    /\ ~(x = Host /\ run = "save" /\ ~founded)
    /\ has' = [has EXCEPT ![x] = c]
    /\ ready' = [ready EXCEPT ![x] = @ /\ pick[x] # NoChar]
    /\ UNCHANGED <<conn, at, away, pick, run, line, founded, body, entered>>

\* A character picked in the lobby, or the pick taken back (room.js lobbySay 'pick').
\* Nobody else here has it, and nobody in the run or called.
Pick(x, c) ==
    /\ x \in People
    /\ c \in Chars \cup {NoChar}
    /\ conn[x]
    /\ at[x] = "title"
    /\ x \notin line
    /\ ~ready[x]
    /\ KindFor(x) # "none"
    /\ x = Host => KindFor(x) = "new"
    /\ x = Host => c # NoChar
    /\ c # NoChar => c \notin {CharOf(y) : y \in Here \ {x}}
    /\ c # NoChar => c \notin Busy
    /\ pick' = [pick EXCEPT ![x] = c]
    /\ UNCHANGED <<conn, at, ready, away, has, run, line, founded, body, entered>>

\* A joiner says ready (room.js lobbySay 'ready'). Their character must be theirs alone.
Ready(x) ==
    /\ x \in Joiners
    /\ conn[x]
    /\ at[x] = "title"
    /\ ~ready[x]
    /\ ~away[x]
    /\ run # "none"
    /\ line = {}
    /\ ~founded
    /\ CharOf(x) # NoChar
    /\ CharOf(x) \notin Claimed(x)
    /\ ready' = [ready EXCEPT ![x] = TRUE]
    /\ UNCHANGED <<conn, at, away, pick, has, run, line, founded, body, entered>>

Unready(x) ==
    /\ x \in Joiners
    /\ conn[x]
    /\ ready[x]
    /\ at[x] = "title"
    /\ x \notin line
    /\ ready' = [ready EXCEPT ![x] = FALSE]
    /\ UNCHANGED <<conn, at, away, pick, has, run, line, founded, body, entered>>

\* Five minutes without a key at the title, not ready: away, and no longer holding Start up
\* (client/lobby.js tick, room.js lobbySay 'away').
GoAway(x) ==
    /\ x \in Joiners
    /\ conn[x]
    /\ at[x] = "title"
    /\ ~ready[x]
    /\ ~away[x]
    /\ away' = [away EXCEPT ![x] = TRUE]
    /\ UNCHANGED <<conn, at, ready, pick, has, run, line, founded, body, entered>>

Back(x) ==
    /\ x \in People
    /\ away[x]
    /\ away' = [away EXCEPT ![x] = FALSE]
    /\ UNCHANGED <<conn, at, ready, pick, has, run, line, founded, body, entered>>

\* The host's Start (room.js lobbySay 'start'): only with every person here, at the title
\* and not away, ready. Called: the host and everyone ready.
Start ==
    /\ line = {}
    /\ ~founded
    /\ run # "none"
    /\ conn[Host]
    /\ at[Host] = "title"
    /\ CharOf(Host) # NoChar
    /\ \A y \in Joiners : (conn[y] /\ at[y] = "title" /\ ~away[y]) => ready[y]
    /\ line' = {Host} \cup {y \in Joiners : conn[y] /\ ready[y]}
    /\ UNCHANGED <<conn, at, ready, away, pick, has, run, founded, body, entered>>

\* Someone called starts their game ('go'; client/lobby.js begin): as what the lobby said.
BeginLoad(x) ==
    /\ x \in line
    /\ conn[x]
    /\ at[x] = "title"
    /\ at' = [at EXCEPT ![x] = "loading"]
    /\ body' = [body EXCEPT ![x] = CharOf(x)]
    /\ UNCHANGED <<conn, ready, away, pick, has, run, line, founded, entered>>

\* Called, and not coming after all: still at the title a while later (room.js 'p',
\* LINE_TITLE), their save gone ('leave'), or back at the title of their own accord. The host
\* giving up before the run exists calls the start off (room.js lobbyGone).
GiveUp(x) ==
    /\ x \in line
    /\ conn[x]
    /\ at[x] # "in"
    /\ LET cancel == x = Host /\ ~founded
       IN /\ line' = IF cancel THEN {} ELSE line \ {x}
          /\ run' = IF cancel THEN "none" ELSE run
          /\ pick' = [y \in People |-> IF cancel THEN NoChar ELSE pick[y]]
          /\ has' = [y \in People |-> IF cancel THEN NoChar ELSE has[y]]
          /\ ready' = [y \in People |-> ready[y] /\ ~cancel /\ y # x]
          /\ at' = [y \in Actors |-> IF y = x THEN "title"
                                     ELSE IF cancel /\ y \in line /\ conn[y] /\ at[y] = "loading" THEN "off"
                                     ELSE at[y]]
    /\ body' = [body EXCEPT ![x] = NoChar]
    /\ away' = [away EXCEPT ![x] = FALSE]
    /\ UNCHANGED <<conn, founded, entered>>

\* A game begun from the game's own title menu: nobody else here, the host away and no run
\* under way, or the line down (client/lobby.js L.menu returns null). Any character.
SoloStart(x, c) ==
    /\ x \in People
    /\ c \in Chars
    /\ at[x] = "title"
    /\ x \notin line
    /\ ~(conn[x] /\ LobbyOn)
    /\ at' = [at EXCEPT ![x] = "loading"]
    /\ body' = [body EXCEPT ![x] = c]
    /\ UNCHANGED <<conn, ready, away, pick, has, run, line, founded, entered>>

\* Back to the title from a game that is not in the run, of their own accord.
Quit(x) ==
    /\ x \in People
    /\ at[x] = "loading"
    /\ x \notin line
    /\ at' = [at EXCEPT ![x] = "title"]
    /\ body' = [body EXCEPT ![x] = NoChar]
    /\ UNCHANGED <<conn, ready, away, pick, has, run, line, founded, entered>>

\* The start was called off: the page goes back to the title (client/lobby.js, World._bounce).
Bounce(x) ==
    /\ conn[x]
    /\ at[x] = "off"
    /\ at' = [at EXCEPT ![x] = "title"]
    /\ body' = [body EXCEPT ![x] = NoChar]
    /\ UNCHANGED <<conn, ready, away, pick, has, run, line, founded, entered>>

\* The partner starts its game once a person is in the dungeon (tools/bot-page.js tick),
\* as whoever it was cast (partners.js castPick): the room has no say in that yet.
PartnerLoad(c) ==
    /\ c \in Chars
    /\ conn[Partner]
    /\ at[Partner] = "title"
    /\ \E y \in People : at[y] = "in"
    /\ at' = [at EXCEPT ![Partner] = "loading"]
    /\ body' = [body EXCEPT ![Partner] = c]
    /\ UNCHANGED <<conn, ready, away, pick, has, run, line, founded, entered>>

\* The load is done and world? is answered with the world (room.js 'world?').
\*  - While the host is called, nobody else founds the run (the host-first wait); with the
\*    host not called, someone done loading goes on alone after two minutes.
\*  - A partner comes in after the people, and never founds a run.
\*  - One body per character; and someone uncalled yields to whoever the lobby has called.
\*  - A start called off founds nothing; into a run founded since, it may still come.
\* Founded by someone the lobby did not call, the lobby starts clean (lobbyReset).
Arrive(x) ==
    /\ conn[x]
    /\ at[x] \in {"loading", "off"}
    /\ at[x] = "off" => founded
    /\ x = Partner => founded
    /\ x = Partner => line = {}
    /\ founded \/ x = Host \/ Host \notin line
    /\ body[x] \notin {body[y] : y \in In}
    /\ x \notin line => body[x] \notin {CharOf(y) : y \in line}
    /\ at' = [at EXCEPT ![x] = "in"]
    /\ founded' = TRUE
    /\ line' = line \ {x}
    /\ entered' = IF founded THEN entered \cup ({x} \cap People) ELSE {x}
    /\ LET reset == ~founded /\ x \notin line
       IN /\ run' \in (IF reset THEN {"new", "save"} ELSE {run})
          /\ pick' = [y \in People |-> IF reset THEN NoChar ELSE pick[y]]
          /\ has' = [y \in People |-> IF reset THEN NoChar ELSE has[y]]
          /\ ready' = [y \in People |-> ready[y] /\ ~reset /\ y # x]
    /\ UNCHANGED <<conn, away, body>>

\* Someone in the run already plays the partner's character (worldclash): it goes back to
\* the title and comes again as someone else (tools/bot-page.js).
PartnerRefused ==
    /\ conn[Partner]
    /\ at[Partner] = "loading"
    /\ founded
    /\ line = {}
    /\ body[Partner] \in {body[y] : y \in In}
    /\ at' = [at EXCEPT ![Partner] = "title"]
    /\ body' = [body EXCEPT ![Partner] = NoChar]
    /\ UNCHANGED <<conn, ready, away, pick, has, run, line, founded, entered>>

\* Back to the title on purpose (room.js wentToTitle). The last person in sends the partner
\* home (endWithPartners) and the run ends (leaveWorld -> lobbyReset): whoever was on the
\* way in is called off, and the next run is chosen afresh.
BackToTitle(x) ==
    /\ x \in People
    /\ at[x] = "in"
    /\ LET last == ~\E y \in People \ {x} : at[y] = "in"
       IN /\ founded' = ~last
          /\ conn' = [y \in Actors |-> conn[y] /\ ~(last /\ y = Partner)]
          /\ at' = [y \in Actors |-> IF y = x \/ (last /\ y = Partner) THEN "title"
                                     ELSE IF last /\ y \in line /\ conn[y] /\ at[y] = "loading" THEN "off"
                                     ELSE at[y]]
          /\ body' = [y \in Actors |-> IF y = x \/ (last /\ y = Partner) THEN NoChar ELSE body[y]]
          /\ line' = IF last THEN {} ELSE line
          /\ run' = IF last THEN "none" ELSE run
          /\ pick' = [y \in People |-> IF last THEN NoChar ELSE pick[y]]
          /\ has' = [y \in People |-> IF last THEN NoChar ELSE has[y]]
          /\ ready' = [y \in People |-> ready[y] /\ ~last]
    /\ UNCHANGED <<away, entered>>

\* Joining a run under way, late or coming back (the Join line; room.js lobbySay 'join').
Join(x) ==
    /\ x \in People
    /\ founded
    /\ conn[x]
    /\ at[x] = "title"
    /\ x \notin line
    /\ ~away[x]
    /\ CharOf(x) # NoChar
    /\ CharOf(x) \notin Busy
    /\ line' = line \cup {x}
    /\ UNCHANGED <<conn, at, ready, away, pick, has, run, founded, body, entered>>

Next ==
    \/ \E x \in Actors : Connect(x)
    \/ \E x \in Actors : Drop(x)
    \/ \E x \in People : HoldEnds(x)
    \/ \E r \in {"none", "new", "save"}, c \in Chars \cup {NoChar} : ChooseRun(r, c)
    \/ \E x \in People, c \in Chars \cup {NoChar} : Has(x, c)
    \/ \E x \in People, c \in Chars \cup {NoChar} : Pick(x, c)
    \/ \E x \in People : Ready(x)
    \/ \E x \in People : Unready(x)
    \/ \E x \in People : GoAway(x)
    \/ \E x \in People : Back(x)
    \/ Start
    \/ \E x \in People : BeginLoad(x)
    \/ \E x \in People : GiveUp(x)
    \/ \E x \in People, c \in Chars : SoloStart(x, c)
    \/ \E x \in People : Quit(x)
    \/ \E x \in People : Bounce(x)
    \/ \E c \in Chars : PartnerLoad(c)
    \/ \E x \in Actors : Arrive(x)
    \/ PartnerRefused
    \/ \E x \in People : BackToTitle(x)
    \/ \E x \in People : Join(x)
\* mutate:end

\* The room and the pages act whenever they can: someone called and here gets their 'go'
\* even if their line flickers (strong), a load finishes, a page called off goes back.
Spec == Init /\ [][Next]_vars
        /\ \A x \in People : SF_vars(BeginLoad(x)) /\ SF_vars(Arrive(x)) /\ WF_vars(Bounce(x)) /\ WF_vars(HoldEnds(x))

\* ---- invariants ----
\* Nobody stands in a run the room does not have, and a run nobody is in is over: else it
\* refuses the host's own save (11/03 lockout, room.js TITLE_GHOST).
InMeansRun == In # {} => founded
RunHasSomeone == founded => In # {}
RunKnown == founded => run # "none"
\* One body per character in the run (room.js 'world?', worldclash).
UniqueIn == \A x, y \in In : x # y => body[x] # body[y]
InHasBody == \A x \in In : body[x] # NoChar
\* Whoever the lobby has called has a character nobody else called has, and nobody in the run.
CalledUnique ==
    \A x \in line :
        /\ CharOf(x) # NoChar
        /\ \A y \in line \ {x} : CharOf(y) # CharOf(x)
        /\ \A y \in In : body[y] # CharOf(x)
\* ...and loads as that character, so the door never refuses them.
CalledLoadsPick == \A x \in line : at[x] = "loading" => body[x] = CharOf(x)
CalledNeverRefused == \A x \in line : at[x] = "loading" => body[x] \notin {body[y] : y \in In}
\* Before the run exists, a start under way always has the host in it.
HostInStart == (line # {} /\ ~founded) => Host \in line
LineNeedsRun == line # {} => run # "none"
OffNotCalled == \A x \in People : at[x] = "off" => x \notin line
AwayIsIdle == \A x \in People : away[x] => ~ready[x]
\* Only someone here plays: a dropped line is out of the run (room.js drop). Called and the
\* line down is a hold: only ever for a game that was called, never one at the title asking.
ConnectedIfPresent == \A x \in Actors : at[x] = "in" => conn[x]
\* Nothing is said for someone who is not here, except what a hold keeps.
GoneIsForgotten == \A x \in People : (~conn[x] /\ x \notin line) => (pick[x] = NoChar /\ has[x] = NoChar /\ ~ready[x])
\* Ready is a lobby thing: it ends on the way in, so last night's never starts the next.
ReadyIsLobby == \A x \in People : ready[x] => (conn[x] /\ at[x] # "in" /\ (x \in line \/ (at[x] = "title" /\ ~founded)))
\* Carrying a save on, the host is who that save is: the run is theirs.
HostKeepsSave == (run = "save" /\ ~founded /\ conn[Host]) => (pick[Host] = NoChar /\ has[Host] # NoChar)

\* ---- action properties ----
\* A start happens only with every person here, at the title and not away, ready (his rule, 11/08).
StartNeedsEveryone ==
    [][(line = {} /\ line' # {} /\ ~founded) =>
          \A y \in Joiners : (conn[y] /\ at[y] = "title" /\ ~away[y]) => ready[y]]_vars
\* A run is founded by a person's game, never a partner's; and while the host is called,
\* by the host's and nobody else's (room.js 'world?', the host-first wait).
HostFounds ==
    [][(~founded /\ founded') =>
          \E x \in People : /\ at[x] # "in"
                            /\ at'[x] = "in"
                            /\ (x = Host \/ (x \notin line /\ Host \notin line))]_vars
\* With the lobby on screen nobody's game starts uncalled.
LobbyGates ==
    [][\A x \in People : (conn[x] /\ at[x] = "title" /\ at'[x] = "loading") => (x \in line \/ ~LobbyOn)]_vars
\* The partner comes in only once no person is still on the way in.
PartnerAfterPeople == [][(at[Partner] # "in" /\ at'[Partner] = "in") => line = {}]_vars
\* Ready given for one night never counts for another, nor a character picked for it: a pick
\* made for a new run would else bring that person into a Continue as a fresh character.
RunChangeResets == [][run' # run => \A x \in Joiners : ~ready'[x] /\ pick'[x] = NoChar]_vars
\* Ready says what that person will load: it cannot change while they stay ready.
ReadyHoldsChar == [][\A x \in Joiners : (ready[x] /\ ready'[x]) => CharOf(x)' = CharOf(x)]_vars
\* The last person to leave on purpose ends the run, partners or not (10/31: else the next
\* New Game silently joined the old run). A dropped line is not leaving on purpose.
LastOutEndsRun ==
    [][((\E x \in People : at[x] = "in" /\ at'[x] = "title" /\ conn'[x]) /\ (\A y \in People : at'[y] # "in")) => ~founded']_vars
\* A character never changes while its game runs, nor while its player is called.
CharStable ==
    [][/\ \A x \in Actors : (at[x] # "title" /\ at'[x] # "title") => body'[x] = body[x]
       /\ \A x \in People : (x \in line /\ x \in line') => CharOf(x)' = CharOf(x)]_vars
\* Someone here and called leaves the call only by coming in, by the start being off or the
\* run over, or by being back at the title: never turned away at the door.
LineKeepsPeople ==
    [][\A x \in People : (x \in line /\ x \notin line' /\ conn'[x]) => (at'[x] = "in" \/ line' = {} \/ at'[x] = "title")]_vars
\* Whoever was called and loading when the call ended without them (the start off, the run
\* over) is called off: their game goes back to the title and founds nothing on the way.
CalledOffIsOff ==
    [][\A x \in People : (x \in line /\ x \notin line' /\ at[x] = "loading" /\ conn'[x]) => at'[x] \in {"in", "off", "title"}]_vars

\* A line that drops on the way in does not lose the call (Grok g14: a third person took the
\* character and the first was refused at the door): while the start stands, they stay
\* called, as the same character.
DropKeepsCall ==
    [][\A x \in People : (x \in line /\ conn[x] /\ ~conn'[x] /\ line' # {}) => (x \in line' /\ CharOf(x)' = CharOf(x))]_vars

\* ---- liveness ----
LineMoves == \A x \in People : (x \in line) ~> (x \notin line)
OffEnds == \A x \in People : (at[x] = "off") ~> (at[x] # "off")

\* ---- witnesses ----
Witness_PartyIn == Cardinality(In) = 3
Witness_PartnerIn == at[Partner] = "in"
Witness_ClashCaught == \E x, y \in Joiners : x # y /\ run = "save" /\ ready[x] /\ conn[y] /\ ~ready[y] /\ pick[x] = NoChar /\ pick[y] = NoChar /\ CharOf(y) = CharOf(x)
Witness_AwaySkipped == line # {} /\ ~founded /\ \E y \in Joiners : conn[y] /\ away[y]
\* Everyone called loads at once: a joiner can be done before the host and has to wait.
Witness_TwoLoading == Cardinality({x \in line : at[x] = "loading"}) = 2
Witness_JoinerWaitsForHost == \E x \in Joiners : ~founded /\ x \in line /\ at[x] = "loading" /\ at[Host] = "title" /\ Host \in line
Witness_JoinCalled == founded /\ line # {}
Witness_RunEnded == ~founded /\ entered # {} /\ \A x \in Actors : at[x] = "title"
Witness_CalledOff == \E x \in People : at[x] = "off"
Witness_HostGoneRunOn == founded /\ ~conn[Host] /\ \E y \in Joiners : at[y] = "in"
Witness_NewRunPicks == run = "new" /\ at[Host] = "in" /\ \E x \in Joiners : at[x] = "in" /\ pick[x] # NoChar
Witness_SaveRun == run = "save" /\ at[Host] = "in" /\ \E x \in Joiners : at[x] = "in" /\ pick[x] = NoChar
\* A joiner founded the run with the host here and not called (two minutes without a start).
Witness_JoinerFounds == \E x \in Joiners : founded /\ entered = {x} /\ conn[Host] /\ at[Host] = "title"
\* An uncalled game stands at the door as a called person's character, and has to yield.
Witness_UncalledYields == \E x \in People \ line, y \in line : conn[x] /\ at[x] = "loading" /\ body[x] = CharOf(y)
Witness_PartnerClash == at[Partner] = "loading" /\ line = {} /\ body[Partner] \in {body[y] : y \in In}
\* A line dropped on the way in, the page played on, and came back to its call.
Witness_Held == \E x \in Joiners : x \in line /\ ~conn[x] /\ at[x] = "loading"
Witness_HeldAtTitle == \E x \in Joiners : x \in line /\ ~conn[x] /\ at[x] = "title"
Witness_HostHeld == founded /\ Host \in line /\ ~conn[Host]
Witness_PartnerWaits == at[Partner] = "loading" /\ founded /\ line # {}
=============================================================================
