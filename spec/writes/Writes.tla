---------------------------- MODULE Writes ----------------------------
(* fh-coop world writes: one shared key (a switch, a variable, a self switch or an event's spot),
   the players' games (client/state.js) and the room on the host's PC (room.js).

   Each game writes the key itself and sends the write; the room keeps the last one it got and
   passes it to everyone else. Found 11/13 (test/samefuzz.js): both games ran the scene that sets
   Moonless's body down where the player stands, each sent its own spot, and each ended on the
   other's for good: the room never sends a write back to its writer, so a writer whose write the
   room took second had already applied the first one on top of its own.

   The fix: the room answers each batch of writes ('wk'), and a game skips a partner's write to a
   key while one of its own to that key is still unanswered. One line is one TCP stream, so the
   answer and the partner's write arrive in the order the room handled them.

   Also modelled: a line that breaks (its messages lost both ways, the page noticing a while
   later and coming back through 'world?'), a write made while the line is dead but not yet
   noticed, and the room's first-throw rule for dice thrown once per world (once).

   Not modelled (assumed): more than one key (each key's writes are independent: batches only
   group them, and the room handles a batch in one step); one batch with several values of one
   key (one frame's flush, state.js World.flush): it is one write of its last value, since the
   room stores the rows in order and passes the batch on whole, the writer holds the last, and a
   die thrown once per world is refused only by a later batch (room.js 'w': the first-throw
   filter looks at the room's table before the batch is stored); a join into someone else's
   world (the 'join' mode drops local values for absent keys: a value of 0 is not a write); the
   room taking a player out of the world while their line stays up (room.js 'world?' leaveWorld
   on a New Game, for whoever is still reading the Fortress ending on map 86: their later
   writes are answered and dropped, but the run they belong to is over; Grok 11/14); a scene's
   claim on a switch (client/state.js claimed: a 20-second local hold, by design); demotion of a
   key that flaps (it stops being shared). *)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS Clients,     \* the players' games
          Vals,        \* values a game can write
          Nil,         \* the room has never had the key (and a game's value before any write)
          MaxWrites,   \* writes per game (bound)
          MaxDrops     \* broken lines in all (bound)

Msg == [t : {"w", "wk", "ask", "world"}, v : Vals \cup {Nil}]
W(v) == [t |-> "w", v |-> v]
Ack == [t |-> "wk", v |-> Nil]
Ask == [t |-> "ask", v |-> Nil]
Table(v) == [t |-> "world", v |-> v]

VARIABLES val,      \* game -> its value of the key
          flight,   \* game -> its writes sent and not answered (client/state.js inFlight)
          live,     \* game -> in the shared world (World.live): it writes and applies only then
          line,     \* game -> "up" | "dead" (broken, the page has not noticed) | "down" (retrying)
          toRoom,   \* game -> messages on their way to the room, in order
          toCli,    \* game -> messages on their way from the room, in order
          room,     \* the room's value (room.world)
          inRoom,   \* game -> the room passes writes to it (peer.live)
          once,     \* the key is a die thrown once per world (room.js ONCE); fixed at the start
          writes,   \* game -> writes made (bound)
          drops,    \* broken lines so far (bound)
          seen      \* ghost: what has happened, for the witnesses

vars == <<val, flight, live, line, toRoom, toCli, room, inRoom, once, writes, drops, seen>>

Count(s, t) == Cardinality({i \in DOMAIN s : s[i].t = t})

TypeOK ==
    /\ val \in [Clients -> Vals \cup {Nil}]
    /\ flight \in [Clients -> Nat]
    /\ live \in [Clients -> BOOLEAN]
    /\ line \in [Clients -> {"up", "dead", "down"}]
    /\ \A c \in Clients : \A i \in DOMAIN toRoom[c] : toRoom[c][i] \in Msg
    /\ \A c \in Clients : \A i \in DOMAIN toCli[c] : toCli[c][i] \in Msg
    /\ room \in Vals \cup {Nil}
    /\ inRoom \in [Clients -> BOOLEAN]
    /\ once \in BOOLEAN
    /\ writes \in [Clients -> 0..MaxWrites]
    /\ drops \in 0..MaxDrops

\* Everyone in, every line up, nothing on the way.
Settled == \A c \in Clients : line[c] = "up" /\ live[c] /\ toRoom[c] = <<>> /\ toCli[c] = <<>>

Init ==
    /\ val = [c \in Clients |-> Nil]
    /\ flight = [c \in Clients |-> 0]
    /\ live = [c \in Clients |-> TRUE]
    /\ line = [c \in Clients |-> "up"]
    /\ toRoom = [c \in Clients |-> <<>>]
    /\ toCli = [c \in Clients |-> <<>>]
    /\ room = Nil
    /\ inRoom = [c \in Clients |-> TRUE]
    /\ once \in BOOLEAN
    /\ writes = [c \in Clients |-> 0]
    /\ drops = 0
    /\ seen = {}

\* Nothing left to happen: not a deadlock.
Done == Settled /\ UNCHANGED vars

\* mutate:begin
\* A scene sets it (state.js:436 setValue, only on a change), queue counts it on the way
\* (state.js:115, 126 onTheWay), the frame's flush sends it (state.js:152, net.js:69); on a line
\* that is dead and not noticed yet the send goes nowhere.
Write(c, v) ==
    /\ live[c]
    /\ writes[c] < MaxWrites   \* mutate:skip bound: without it the state space has no end
    /\ v # val[c]   \* mutate:skip not needed (state.js:436, 558, 568, 120 never queue an unchanged value): without it a game also re-sends what it holds, and every property still holds (mutant survived 11/14)
    /\ val' = [val EXCEPT ![c] = v]
    /\ writes' = [writes EXCEPT ![c] = @ + 1]   \* mutate:skip bound bookkeeping
    /\ flight' = [flight EXCEPT ![c] = @ + 1]
    /\ toRoom' = IF line[c] = "up" THEN [toRoom EXCEPT ![c] = Append(@, W(v))] ELSE toRoom
    /\ seen' = seen \cup {IF line[c] = "up" THEN "write" ELSE "lost"}   \* mutate:skip ghost
    /\ UNCHANGED <<live, line, toCli, room, inRoom, once, drops>>

\* room.js:976 'w': answered first (979), kept (996), passed on to everyone else in the world (1000).
RoomTakes(c) ==
    /\ toRoom[c] # <<>>
    /\ Head(toRoom[c]).t = "w"
    /\ ~(once /\ room # Nil)
    /\ room' = Head(toRoom[c]).v
    /\ toRoom' = [toRoom EXCEPT ![c] = Tail(@)]
    /\ toCli' = [d \in Clients |-> IF d = c THEN Append(toCli[d], Ack)
                                   ELSE IF inRoom[d] THEN Append(toCli[d], Head(toRoom[c]))
                                   ELSE toCli[d]]
    /\ UNCHANGED <<val, flight, live, line, inRoom, once, writes, drops, seen>>

\* room.js:985-992: a die thrown once per world that already has its throw: answered (979), then
\* the throw that stands is sent back to the writer (992).
RoomRefuses(c) ==
    /\ toRoom[c] # <<>>
    /\ Head(toRoom[c]).t = "w"
    /\ once
    /\ room # Nil
    /\ toRoom' = [toRoom EXCEPT ![c] = Tail(@)]
    /\ toCli' = [toCli EXCEPT ![c] = @ \o <<Ack, W(room)>>]
    /\ seen' = seen \cup {"refused"}   \* mutate:skip ghost
    /\ UNCHANGED <<val, flight, live, line, room, inRoom, once, writes, drops>>

\* room.js:693 'world?': in the world from here on (803), the room's table back (812).
RoomAsked(c) ==
    /\ toRoom[c] # <<>>
    /\ Head(toRoom[c]).t = "ask"
    /\ inRoom' = [inRoom EXCEPT ![c] = TRUE]
    /\ toRoom' = [toRoom EXCEPT ![c] = Tail(@)]
    /\ toCli' = [toCli EXCEPT ![c] = Append(@, Table(room))]
    /\ UNCHANGED <<val, flight, live, line, room, once, writes, drops, seen>>

\* state.js:143 'wk': the oldest batch is answered.
GetsAck(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "wk"
    /\ flight' = [flight EXCEPT ![c] = IF @ > 0 THEN @ - 1 ELSE 0]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ UNCHANGED <<val, live, line, toRoom, room, inRoom, once, writes, drops, seen>>

\* state.js:595 'w': applied (603), unless one of this game's own writes to the key is on the
\* way (600). Out of the world it is dropped (596), which never happens here (WriteFindsLive).
GetsWrite(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "w"   \* mutate:skip equivalent: in the world with nothing on the way, a write is all that can be at the head (FlightIsTrue rules out an answer, TableFindsOut a table)
    /\ live[c]   \* mutate:skip equivalent: a write only ever reaches a game in the world (invariant WriteFindsLive)
    /\ flight[c] = 0
    /\ val' = [val EXCEPT ![c] = Head(toCli[c]).v]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ UNCHANGED <<flight, live, line, toRoom, room, inRoom, once, writes, drops, seen>>

SkipsWrite(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "w"
    /\ live[c]   \* mutate:skip equivalent: a write only ever reaches a game in the world (invariant WriteFindsLive)
    /\ flight[c] > 0
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ seen' = seen \cup {"skipped"}   \* mutate:skip ghost
    /\ UNCHANGED <<val, flight, live, line, toRoom, room, inRoom, once, writes, drops>>

\* state.js:977 'world' (a line back: mode 'again'): the room's value where it has one (1002);
\* this game's own value contributed where it has none (1027-1028, counted on the way); in (1030).
GetsTable(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "world"
    /\ Head(toCli[c]).v # Nil
    /\ val' = [val EXCEPT ![c] = Head(toCli[c]).v]
    /\ live' = [live EXCEPT ![c] = TRUE]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ seen' = seen \cup {IF val[c] # Head(toCli[c]).v THEN "corrected" ELSE "table"}   \* mutate:skip ghost
    /\ UNCHANGED <<flight, line, toRoom, room, inRoom, once, writes, drops>>

GetsEmptyTable(c) ==
    /\ toCli[c] # <<>>
    /\ Head(toCli[c]).t = "world"
    /\ Head(toCli[c]).v = Nil
    /\ live' = [live EXCEPT ![c] = TRUE]
    /\ toCli' = [toCli EXCEPT ![c] = Tail(@)]
    /\ toRoom' = IF val[c] # Nil THEN [toRoom EXCEPT ![c] = Append(@, W(val[c]))] ELSE toRoom
    /\ flight' = IF val[c] # Nil THEN [flight EXCEPT ![c] = @ + 1] ELSE flight
    /\ seen' = seen \cup {IF val[c] # Nil THEN "contributed" ELSE "table"}   \* mutate:skip ghost
    /\ UNCHANGED <<val, line, room, inRoom, once, writes, drops>>

\* The line breaks: what was on it is lost both ways, and the room drops the player at once
\* (room.js:105 close, 522 drop). The page has not noticed yet.
Breaks(c) ==
    /\ line[c] = "up"   \* mutate:skip not needed (a line that is down has no socket to break): without it a broken line only breaks again with nothing on it, and every property still holds (mutant survived 11/14)
    /\ drops < MaxDrops   \* mutate:skip bound: without it the state space has no end
    /\ line' = [line EXCEPT ![c] = "dead"]
    /\ toRoom' = [toRoom EXCEPT ![c] = <<>>]
    /\ toCli' = [toCli EXCEPT ![c] = <<>>]
    /\ inRoom' = [inRoom EXCEPT ![c] = FALSE]
    /\ drops' = drops + 1   \* mutate:skip bound bookkeeping
    /\ UNCHANGED <<val, flight, live, room, once, writes, seen>>

\* net.js:174 onclose, 184 'offline' -> state.js 'offline': out of the world, and what was on the
\* way is forgotten (1059).
Notices(c) ==
    /\ line[c] = "dead"
    /\ line' = [line EXCEPT ![c] = "down"]
    /\ live' = [live EXCEPT ![c] = FALSE]
    /\ flight' = [flight EXCEPT ![c] = 0]
    /\ UNCHANGED <<val, toRoom, toCli, room, inRoom, once, writes, drops, seen>>

\* net.js:187 retry; on the new line the game asks to come back in (state.js:837 'world?').
Reconnects(c) ==
    /\ line[c] = "down"
    /\ line' = [line EXCEPT ![c] = "up"]
    /\ toRoom' = [toRoom EXCEPT ![c] = <<Ask>>]
    /\ UNCHANGED <<val, flight, live, toCli, room, inRoom, once, writes, drops, seen>>

Next ==
    \/ \E c \in Clients, v \in Vals : Write(c, v)
    \/ \E c \in Clients : RoomTakes(c)
    \/ \E c \in Clients : RoomRefuses(c)
    \/ \E c \in Clients : RoomAsked(c)
    \/ \E c \in Clients : GetsAck(c)
    \/ \E c \in Clients : GetsWrite(c)
    \/ \E c \in Clients : SkipsWrite(c)
    \/ \E c \in Clients : GetsTable(c)
    \/ \E c \in Clients : GetsEmptyTable(c)
    \/ \E c \in Clients : Breaks(c)
    \/ \E c \in Clients : Notices(c)
    \/ \E c \in Clients : Reconnects(c)
    \/ Done
\* mutate:end

\* Fairness: a line that is up delivers (TCP); a page notices a dead line (the proxy's 10-second
\* ping, server.js DEAD_AFTER, or the socket's own close) and keeps retrying (net.js:187).
Receive(c) ==
    \/ RoomTakes(c) \/ RoomRefuses(c) \/ RoomAsked(c)
    \/ GetsAck(c) \/ GetsWrite(c) \/ SkipsWrite(c) \/ GetsTable(c) \/ GetsEmptyTable(c)
Spec == Init /\ [][Next]_vars
        /\ \A c \in Clients : WF_vars(Receive(c)) /\ WF_vars(Notices(c)) /\ WF_vars(Reconnects(c))

Perms == Permutations(Clients)

\* ---- invariants ----
\* The point: once nothing is on the way, every game holds what the room holds.
Agree == Settled => \A c \in Clients : val[c] = room

\* What a game counts on the way is exactly what is: its writes the room has not had, and the
\* room's answers it has not read. So a game never goes on skipping a key's writes for good.
FlightIsTrue == \A c \in Clients : line[c] = "up" => flight[c] = Count(toRoom[c], "w") + Count(toCli[c], "wk")

\* The room's table is applied as it stands (state.js:1002): nothing of this game's is on the way.
NothingOnTheWayAtTable == \A c \in Clients :
    toCli[c] # <<>> /\ Head(toCli[c]).t = "world" => flight[c] = 0

\* A partner's write never reaches a game out of the world: the table comes first.
WriteFindsLive == \A c \in Clients : toCli[c] # <<>> /\ Head(toCli[c]).t = "w" => live[c]

\* The table only ever answers a game out of the world (state.js:817 World.enter asks only then;
\* room.js:812 sends it only as that answer).
TableFindsOut == \A c \in Clients : toCli[c] # <<>> /\ Head(toCli[c]).t = "world" => ~live[c]

\* The room never takes a key away: a game that has written it holds some value of it.
WrittenStays == \A c \in Clients : writes[c] > 0 => val[c] # Nil

\* ---- action properties ----
\* A die thrown once stands: the room keeps its first value.
FirstThrowStands == [][once /\ room # Nil => room' = room]_vars

\* Any other key: each write the room handles becomes its value.
RoomTakesEachWrite == [][\A c \in Clients :
    (~once /\ toRoom[c] # <<>> /\ Head(toRoom[c]).t = "w" /\ line'[c] = "up" /\ Len(toRoom'[c]) < Len(toRoom[c]))
        => room' = Head(toRoom[c]).v]_vars

\* Taking the room's value, from a partner's write or from the table, sends nothing back
\* (state.js:603 and 1002 apply writes the game's data directly, not through setValue, so the hooks
\* never queue it). An echo would be one more write the room takes: everyone would still agree, on
\* an older value over a newer one (Grok 11/14, rounds 2 and 3). An empty table is not the room's
\* value: this game's own is then contributed.
NoEcho == [][\A c \in Clients :
    (toCli[c] # <<>> /\ Head(toCli[c]).t \in {"w", "world"} /\ Head(toCli[c]).v # Nil
        /\ line'[c] = "up" /\ toCli'[c] = Tail(toCli[c]))
        => toRoom'[c] = toRoom[c]]_vars

\* ---- liveness ----
SettlesInAgreement == <>[](Settled /\ \A c \in Clients : val[c] = room)

\* ---- witnesses ----
\* Two games wrote and the room ended on one of them, with a partner's write skipped on the way.
Witness_Crossed == Settled /\ "skipped" \in seen /\ \E c, d \in Clients : c # d /\ writes[c] > 0 /\ writes[d] > 0
Witness_Refused == Settled /\ "refused" \in seen
Witness_Lost == Settled /\ "lost" \in seen
Witness_Corrected == Settled /\ "corrected" \in seen
Witness_Contributed == Settled /\ "contributed" \in seen
=============================================================================
