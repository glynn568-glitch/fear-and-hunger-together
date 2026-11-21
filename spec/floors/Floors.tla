---------------------------- MODULE Floors ----------------------------
(* fh-coop floor switches (client/state.js World.fs, the world kind 'fs'): one switch the game reads on
   two maps, shared per map. The black witch's four (census swFloor: 3451 fights, 3453/3457 the tiles,
   3454 shown) wake her on the Ancient city's inside (114) and on the Grand library (116) both, and the
   room-change event (common event 271, on 854 door pages) turns them off on whichever map the door is on.

   0.1.20 and 0.1.21 shared them as one switch: a wake on one floor woke the other floor's copy of her for
   a partner standing there (Grok 11/14, the known issue in both notes), and a door anywhere sent her
   away for everyone. Now a game writes the key of the map it stands on ('map,switch'), keeps every
   map's value as the room passes it on, and its own switch shows the value of the map it stands on:
   set again on every map change and when the room's table comes in.

   One key per map, so the room's part is spec/writes/Writes.tla's for each (an answer per batch, a
   partner's write skipped while one of this game's own to that key is on the way, the table on the way
   back in). Modelled again here because each game now moves between maps, and what it shows depends on
   where it stands; a broken line, a door taken while it is down, and both kinds of table (a line back:
   this game's own values contributed where the room has none; joining someone else's world: dropped).

   Not modelled (assumed): more than one switch (each 'map,switch' is its own key: batches only group
   them); a batch of several rows (one step per row here, which lets more happen between them than the
   room does); the first-throw rule (dice are variables, never floor switches); demotion of a key that
   flaps (it stops being shared, as any key); a map whose file differs from a partner's (not shared there
   at all: World.isShared 'fs'); a scene's claim (state.js claimed: none of the four is ever claimed, as
   neither the tiles nor the witch's pages hide or move their player); saves. A save keeps World.fs whole and
   a load restores exactly that: never the floor it stands on from its switches, which after a door taken
   out of the world (Move with ~live) still show the floor left (Grok 11/17, round 2). The way back in sets
   the switches (GetsTable). Checked by test/carry.js, twins witch-save and witch-load-overlay.

   Taken as designed (Grok 11/17, round 3): an off written while the line is down, to a key the room
   already has, loses to the room's value on the way back in (GetsTable keeps a game's own only where the
   table is Nil). Every world kind does the same (state.js 'world': the apply loop, then only keys the room
   lacks are contributed), so a door taken in the seconds a line is down does not send her away. Nor is the
   shown switch (3454) modelled apart from the fighting one (3451): a partner's wake page that ends just
   before a door's offs reach it leaves 3451 on and 3454 off, both games agreeing; 3454 is read only by
   EV209/EV309 page 0, which the 3451 page outranks, so she plays as out. The wake page itself (EV210/308/319
   page 1, parallel on 3453 or 3457) stops when the offs land: the page changes and the game drops its
   interpreter. *)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS Clients,     \* the players' games
          Maps,        \* the maps that read the switch (and any other a player stands on)
          Nil,         \* the room has never had the key
          MaxWrites,   \* writes per game (bound)
          MaxMoves,    \* map changes in all (bound)
          MaxDrops     \* broken lines in all (bound)

Vals == {0, 1}
Modes == {"again", "join"}
W(m, v) == [t |-> "w", m |-> m, v |-> v]
Ack(m) == [t |-> "wk", m |-> m, v |-> 0]
Ask == [t |-> "ask", m |-> Nil, v |-> 0]
Table(tab, mode) == [t |-> "world", tab |-> tab, mode |-> mode]

RECURSIVE SetToSeq(_)
SetToSeq(S) == IF S = {} THEN <<>> ELSE LET x == CHOOSE x \in S : TRUE IN <<x>> \o SetToSeq(S \ {x})

VARIABLES at,       \* game -> the map it stands on ($gameMap.mapId())
          sw,       \* game -> its switch ($gameSwitches), which the pages of the map it stands on read
          fs,       \* game -> map -> its value of that map's key (World.fs)
          flight,   \* game -> map -> its writes to that key sent and not answered (inFlight)
          live,     \* game -> in the shared world (World.live)
          line,     \* game -> "up" | "dead" (broken, the page has not noticed) | "down" (retrying)
          toRoom,   \* game -> messages on their way to the room, in order
          toCli,    \* game -> messages on their way from the room, in order
          room,     \* map -> the room's value (room.world.fs), Nil if never written
          inRoom,   \* game -> the room passes writes to it (peer.live)
          writes,   \* game -> writes made (bound)
          moves,    \* map changes so far (bound)
          drops,    \* broken lines so far (bound)
          woke,     \* ghost: the maps a game turned the switch on while standing there
          seen      \* ghost: what has happened, for the witnesses

vars == <<at, sw, fs, flight, live, line, toRoom, toCli, room, inRoom, writes, moves, drops, woke, seen>>

CountW(s, m) == Cardinality({i \in DOMAIN s : s[i].t = "w" /\ s[i].m = m})
CountAck(s, m) == Cardinality({i \in DOMAIN s : s[i].t = "wk" /\ s[i].m = m})
RoomOr0(m) == IF room[m] = Nil THEN 0 ELSE room[m]

TypeOK ==
    /\ at \in [Clients -> Maps]
    /\ sw \in [Clients -> Vals]
    /\ fs \in [Clients -> [Maps -> Vals]]
    /\ flight \in [Clients -> [Maps -> Nat]]
    /\ live \in [Clients -> BOOLEAN]
    /\ line \in [Clients -> {"up", "dead", "down"}]
    /\ room \in [Maps -> Vals \cup {Nil}]
    /\ inRoom \in [Clients -> BOOLEAN]
    /\ writes \in [Clients -> 0..MaxWrites]
    /\ moves \in 0..MaxMoves
    /\ drops \in 0..MaxDrops
    /\ woke \subseteq Maps

\* Everyone in, every line up, nothing on the way.
Settled == \A c \in Clients : line[c] = "up" /\ live[c] /\ toRoom[c] = <<>> /\ toCli[c] = <<>>

Init ==
    /\ at \in [Clients -> Maps]
    /\ sw = [c \in Clients |-> 0]
    /\ fs = [c \in Clients |-> [m \in Maps |-> 0]]
    /\ flight = [c \in Clients |-> [m \in Maps |-> 0]]
    /\ live = [c \in Clients |-> TRUE]
    /\ line = [c \in Clients |-> "up"]
    /\ toRoom = [c \in Clients |-> <<>>]
    /\ toCli = [c \in Clients |-> <<>>]
    /\ room = [m \in Maps |-> Nil]
    /\ inRoom = [c \in Clients |-> TRUE]
    /\ writes = [c \in Clients |-> 0]
    /\ moves = 0
    /\ drops = 0
    /\ woke = {}
    /\ seen = {}

\* Nothing left to happen: not a deadlock.
Done == Settled /\ UNCHANGED vars

\* mutate:begin
\* A page sets the switch (state.js:458 setValue, only on a change), written for the map this game
\* stands on (479 writeFloor: kept in World.fs, then queue 127, which in the world counts it on the way
\* and leaves it for the frame's flush 164, and out of it sends nothing). The door's own room change runs
\* before the door moves its player (271 is called before the transfer on 792 of 841 pages).
Write(c, v) ==
    /\ writes[c] < MaxWrites   \* mutate:skip bound: without it the state space has no end
    /\ v # sw[c]   \* mutate:skip not needed (state.js:458 writes only on a change): without it a game in the world re-sends the value it shows (ShowsItsFloor), and every property still holds (mutant survived 11/17)
    /\ sw' = [sw EXCEPT ![c] = v]
    /\ fs' = [fs EXCEPT ![c][at[c]] = v]
    /\ flight' = IF live[c] THEN [flight EXCEPT ![c][at[c]] = @ + 1] ELSE flight
    /\ toRoom' = IF live[c] /\ line[c] = "up" THEN [toRoom EXCEPT ![c] = Append(@, W(at[c], v))] ELSE toRoom
    /\ writes' = [writes EXCEPT ![c] = @ + 1]   \* mutate:skip bound bookkeeping
    /\ woke' = IF v = 1 THEN woke \cup {at[c]} ELSE woke   \* mutate:skip ghost
    /\ seen' = seen \cup {IF ~live[c] THEN "alone" ELSE IF line[c] = "up" THEN "write" ELSE "lost"}   \* mutate:skip ghost
    /\ UNCHANGED <<at, live, line, toCli, room, inRoom, moves, drops>>

\* A transfer to another map (Game_Map.setup, state.js:436): in the world, the switch shows the new map's
\* value as this game keeps it (443 showFloor), before the map's events pick their pages. Out of the
\* world it keeps its own, as the game alone always did.
Move(c, m) ==
    /\ moves < MaxMoves   \* mutate:skip bound: without it the state space has no end
    /\ m # at[c]   \* mutate:skip equivalent: a transfer onto the same map sets the switch to the value it already shows (ShowsItsFloor), as showFloor does on a reload of the same map (mutant survived 11/17)
    /\ at' = [at EXCEPT ![c] = m]
    /\ sw' = IF live[c] THEN [sw EXCEPT ![c] = fs[c][m]] ELSE sw
    /\ moves' = moves + 1   \* mutate:skip bound bookkeeping
    /\ seen' = seen \cup {IF live[c] /\ fs[c][m] = 1 /\ sw[c] = 0 THEN "arrived" ELSE "moved"}   \* mutate:skip ghost
    /\ UNCHANGED <<fs, flight, live, line, toRoom, toCli, room, inRoom, writes, drops, woke>>

\* room.js:990 'w': answered first (993), kept for its map (1010), passed on to everyone else in the
\* world (1014), whatever map they stand on.
RoomTakes(c) ==
    /\ toRoom[c] # <<>>
    /\ Head(toRoom[c]).t = "w"
    /\ room' = [room EXCEPT ![Head(toRoom[c]).m] = Head(toRoom[c]).v]
    /\ toRoom' = [toRoom EXCEPT ![c] = Tail(@)]
    /\ toCli' = [d \in Clients |-> IF d = c THEN Append(toCli[d], Ack(Head(toRoom[c]).m))
                                   ELSE IF inRoom[d] THEN Append(toCli[d], Head(toRoom[c]))
                                   ELSE toCli[d]]
    /\ UNCHANGED <<at, sw, fs, flight, live, line, inRoom, writes, moves, drops, woke, seen>>

\* room.js:707 'world?': in the world from here on, the room's table back with how it comes in (826):
\* 'again' for this session back after a broken line, 'join' for someone else's world (780-782).
RoomAsked(c, mode) ==
    /\ toRoom[c] # <<>>
    /\ Head(toRoom[c]).t = "ask"
    /\ inRoom' = [inRoom EXCEPT ![c] = TRUE]
    /\ toRoom' = [toRoom EXCEPT ![c] = Tail(@)]
    /\ toCli' = [toCli EXCEPT ![c] = Append(@, Table(room, mode))]
    /\ UNCHANGED <<at, sw, fs, flight, live, line, room, writes, moves, drops, woke, seen>>

\* state.js:155 'wk': the oldest batch is answered.
GetsAck(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "wk"
    /\ flight' = [flight EXCEPT ![c][Head(toCli[c]).m] = IF @ > 0 THEN @ - 1 ELSE 0]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ UNCHANGED <<at, sw, fs, live, line, toRoom, room, inRoom, writes, moves, drops, woke, seen>>

\* state.js:670 'w': skipped while one of this game's own writes to the key is on the way (675);
\* otherwise kept for its map, and shown only if this game stands there (apply 'fs', 658).
GetsWrite(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "w"   \* mutate:skip equivalent: in the world with nothing on the way, a write is all that can be at the head (FlightIsTrue rules out an answer, TableFindsOut a table)
    /\ live[c]   \* mutate:skip equivalent: a write only ever reaches a game in the world (invariant WriteFindsLive)
    /\ flight[c][Head(toCli[c]).m] = 0
    /\ fs' = [fs EXCEPT ![c][Head(toCli[c]).m] = Head(toCli[c]).v]
    /\ sw' = [sw EXCEPT ![c] = IF at[c] = Head(toCli[c]).m THEN Head(toCli[c]).v ELSE @]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ UNCHANGED <<at, flight, live, line, toRoom, room, inRoom, writes, moves, drops, woke, seen>>

SkipsWrite(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "w"
    /\ live[c]   \* mutate:skip equivalent: a write only ever reaches a game in the world (invariant WriteFindsLive)
    /\ flight[c][Head(toCli[c]).m] > 0
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ seen' = seen \cup {IF Head(toCli[c]).v # fs[c][Head(toCli[c]).m] THEN "crossed" ELSE "skipped"}   \* mutate:skip ghost
    /\ UNCHANGED <<at, sw, fs, flight, live, line, toRoom, room, inRoom, writes, moves, drops, woke>>

\* state.js:1070 'world': the room's value wherever it has one (the apply loop); where it has none, a line
\* back contributes this game's own (1115-1116, counted on the way) and a join drops it (1099); then the
\* switch shows the map this game stands on (1124, showFloor); in.
GetsTable(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "world"
    /\ LET tab == Head(toCli[c]).tab
           mode == Head(toCli[c]).mode
           now == [m \in Maps |-> IF tab[m] # Nil THEN tab[m] ELSE IF mode = "join" THEN 0 ELSE fs[c][m]]
           mine == SetToSeq({m \in Maps : tab[m] = Nil /\ mode = "again" /\ fs[c][m] = 1})
       IN /\ fs' = [fs EXCEPT ![c] = now]
          /\ sw' = [sw EXCEPT ![c] = now[at[c]]]
          /\ toRoom' = [toRoom EXCEPT ![c] = @ \o [i \in 1..Len(mine) |-> W(mine[i], 1)]]
          /\ flight' = [flight EXCEPT ![c] = [m \in Maps |-> @[m] + (IF \E i \in 1..Len(mine) : mine[i] = m THEN 1 ELSE 0)]]
          /\ seen' = seen \cup {IF sw[c] # now[at[c]] THEN "shown" ELSE IF Len(mine) > 0 THEN "contributed" ELSE IF mode = "join" /\ now # fs[c] THEN "dropped" ELSE "table"}   \* mutate:skip ghost
    /\ live' = [live EXCEPT ![c] = TRUE]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ UNCHANGED <<at, line, room, inRoom, writes, moves, drops, woke>>

\* The line breaks: what was on it is lost both ways, and the room drops the player at once
\* (room.js drop, 538). The page has not noticed yet.
Breaks(c) ==
    /\ line[c] = "up"   \* mutate:skip not needed (a line that is down has no socket to break): without it a broken line only breaks again with nothing on it
    /\ drops < MaxDrops   \* mutate:skip bound: without it the state space has no end
    /\ line' = [line EXCEPT ![c] = "dead"]
    /\ toRoom' = [toRoom EXCEPT ![c] = <<>>]
    /\ toCli' = [toCli EXCEPT ![c] = <<>>]
    /\ inRoom' = [inRoom EXCEPT ![c] = FALSE]
    /\ drops' = drops + 1   \* mutate:skip bound bookkeeping
    /\ UNCHANGED <<at, sw, fs, flight, live, room, writes, moves, woke, seen>>

\* net.js onclose -> state.js:1149 'offline': out of the world, and what was on the way is forgotten.
Notices(c) ==
    /\ line[c] = "dead"
    /\ line' = [line EXCEPT ![c] = "down"]
    /\ live' = [live EXCEPT ![c] = FALSE]
    /\ flight' = [flight EXCEPT ![c] = [m \in Maps |-> 0]]
    /\ UNCHANGED <<at, sw, fs, toRoom, toCli, room, inRoom, writes, moves, drops, woke, seen>>

\* net.js retry; on the new line the game asks to come back in (state.js:892 World.enter, 'world?').
Reconnects(c) ==
    /\ line[c] = "down"
    /\ line' = [line EXCEPT ![c] = "up"]
    /\ toRoom' = [toRoom EXCEPT ![c] = <<Ask>>]
    /\ UNCHANGED <<at, sw, fs, flight, live, toCli, room, inRoom, writes, moves, drops, woke, seen>>

Next ==
    \/ \E c \in Clients, v \in Vals : Write(c, v)
    \/ \E c \in Clients, m \in Maps : Move(c, m)
    \/ \E c \in Clients : RoomTakes(c)
    \/ \E c \in Clients, mode \in Modes : RoomAsked(c, mode)
    \/ \E c \in Clients : GetsAck(c)
    \/ \E c \in Clients : GetsWrite(c)
    \/ \E c \in Clients : SkipsWrite(c)
    \/ \E c \in Clients : GetsTable(c)
    \/ \E c \in Clients : Breaks(c)
    \/ \E c \in Clients : Notices(c)
    \/ \E c \in Clients : Reconnects(c)
    \/ Done
\* mutate:end

\* Fairness: a line that is up delivers (TCP); a page notices a dead line and keeps retrying.
Receive(c) ==
    \/ RoomTakes(c) \/ \E mode \in Modes : RoomAsked(c, mode)
    \/ GetsAck(c) \/ GetsWrite(c) \/ SkipsWrite(c) \/ GetsTable(c)
Spec == Init /\ [][Next]_vars
        /\ \A c \in Clients : WF_vars(Receive(c)) /\ WF_vars(Notices(c)) /\ WF_vars(Reconnects(c))

Perms == Permutations(Clients)

\* ---- invariants ----
\* The bug: a game in the world shows her only on a map where someone woke her.
NoForeignWake == \A c \in Clients : live[c] /\ sw[c] = 1 => at[c] \in woke

\* A game in the world shows the value it keeps for the map it stands on: whoever walks onto her floor
\* while she is out sees her (else she hunts them unseen, Grok 11/14), and nobody sees another floor's.
ShowsItsFloor == \A c \in Clients : live[c] => sw[c] = fs[c][at[c]]

\* Once nothing is on the way, every game keeps every map's value as the room has it, and shows the one
\* it stands on. So two players on one floor see the same (his rule, 11/14: if one of you can see an
\* enemy, so can the other).
Agree == Settled => \A c \in Clients : (\A m \in Maps : fs[c][m] = RoomOr0(m)) /\ sw[c] = RoomOr0(at[c])

\* What a game counts on the way per key is exactly what is: its writes to that map's key the room
\* has not had, and the room's answers it has not read.
FlightIsTrue == \A c \in Clients, m \in Maps :
    line[c] = "up" => flight[c][m] = CountW(toRoom[c], m) + CountAck(toCli[c], m)

\* The room's table is taken as it stands: nothing of this game's is on the way.
NothingOnTheWayAtTable == \A c \in Clients :
    toCli[c] # <<>> /\ Head(toCli[c]).t = "world" => \A m \in Maps : flight[c][m] = 0

\* A partner's write never reaches a game out of the world: the table comes first.
WriteFindsLive == \A c \in Clients : toCli[c] # <<>> /\ Head(toCli[c]).t = "w" => live[c]

\* The table only ever answers a game out of the world.
TableFindsOut == \A c \in Clients : toCli[c] # <<>> /\ Head(toCli[c]).t = "world" => ~live[c]

\* ---- action properties ----
\* Taking the room's word (a partner's write, the table) sends nothing back but what the room lacks
\* (state.js apply writes the game's data directly, never through setValue).
NoEcho == [][\A c \in Clients :
    (toCli[c] # <<>> /\ Head(toCli[c]).t = "w" /\ line'[c] = "up" /\ toCli'[c] = Tail(toCli[c]))
        => toRoom'[c] = toRoom[c]]_vars

\* A line back keeps what the room has no word on: a wake made while the line was down, on a floor this game
\* has since left, is still out after the table (Grok 11/17: forgetting it on every side passes Agree).
KeptWhileDown == [][\A c \in Clients :
    (~live[c] /\ live'[c] /\ Head(toCli[c]).mode = "again")
        => \A m \in Maps : Head(toCli[c]).tab[m] = Nil => fs'[c][m] = fs[c][m]]_vars

\* Walking onto a floor sends nothing: the switch is set to what the run has there, not written (Grok 11/17:
\* re-sent on arrival, a stale wake overtakes a partner's door on its way and the room ends on it).
ArrivalSendsNothing == [][\A c \in Clients : at'[c] # at[c] => toRoom'[c] = toRoom[c]]_vars

\* A write on one map never changes the room's value of another.
WriteStaysOnItsMap == [][\A c \in Clients :
    (toRoom[c] # <<>> /\ Head(toRoom[c]).t = "w" /\ line'[c] = "up" /\ toRoom'[c] = Tail(toRoom[c]))
        => \A m \in Maps \ {Head(toRoom[c]).m} : room'[m] = room[m]]_vars

\* ---- liveness ----
SettlesInAgreement == <>[](Settled /\ \A c \in Clients : (\A m \in Maps : fs[c][m] = RoomOr0(m)) /\ sw[c] = RoomOr0(at[c]))

\* ---- witnesses ----
\* The fix itself: she is out on one floor, the game on the other floor knows and shows nothing.
Witness_Split == Settled /\ \E c, d \in Clients : at[c] # at[d] /\ sw[c] = 1 /\ sw[d] = 0 /\ fs[d][at[c]] = 1
\* A game walked onto a floor where she was out, and shows her.
Witness_Arrived == Settled /\ "arrived" \in seen /\ \E c \in Clients : sw[c] = 1
\* Both wrote one floor's key at once with different values; the partner's skipped on the way, and they agree.
Witness_Crossed == Settled /\ "crossed" \in seen
\* A game came back through the table showing another value than before (a door taken while its line was down).
Witness_Shown == Settled /\ "shown" \in seen
Witness_Contributed == Settled /\ "contributed" \in seen
Witness_Dropped == Settled /\ "dropped" \in seen
Witness_Lost == Settled /\ "lost" \in seen
=============================================================================
