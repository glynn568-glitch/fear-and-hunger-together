--------------------------- MODULE TraceFloors ---------------------------
(* Trace validation for Floors: checks that what the room really did with one floor switch (3451, on
   every map) in a test run, and where each game stood and what it showed whenever nothing was on the
   way, is a behavior of the spec. room.js traceWrite writes one line per thing the room does with the
   switch when FH_WRITES_TRACE names a file and fs3451 (the room's value on each map after it in "room");
   test/hounds.js writes the Init line (where each game stands) and, at each quiet moment, a Settled line
   with where each game stands and what its switch shows. fcheck sets TRACE_FILE to one .ndjson per run.

   What a game does by itself (writing, moving to another map, reading the room's answers and the
   partners' writes, noticing its line broke, coming back) never reaches the room's log: Silent. A
   game's writes are the ones the room logged from it, in that order, each made on the map the room
   logged it for; a write the room never got cannot be named here, and the test makes none. *)
EXTENDS Floors, Json, IOUtils, Sequences

Trace == ndJsonDeserialize(IOEnv.TRACE_FILE)

VARIABLE l   \* events consumed so far

\* What game c wrote, in order: the map and value of each write the room took from it.
Wrote(c) ==
    LET from == SelectSeq(Trace, LAMBDA e : e.event = "Takes" /\ e.who = c)
    IN [i \in 1..Len(from) |-> [m |-> from[i].m, v |-> from[i].v]]

\* Line 1 is {"event":"Init","at":{...}}: everyone in the world on the map logged, the switch never written.
TraceInit ==
    /\ Trace[1].event = "Init"
    /\ l = 1
    /\ Init
    /\ at = Trace[1].at

\* The room's word for how a game comes back in: anything but a join contributes (state.js 'world').
ModeOf(e) == IF e.mode = "join" THEN "join" ELSE "again"

\* One logged event = one action of the spec, with the logged arguments.
Step(e) ==
    CASE e.event = "Takes" -> RoomTakes(e.who) /\ Head(toRoom[e.who]).m = e.m /\ Head(toRoom[e.who]).v = e.v
      [] e.event = "Asked" -> RoomAsked(e.who, ModeOf(e))
      [] e.event = "Breaks" -> Breaks(e.who)
      [] e.event = "Settled" -> Settled /\ (\A c \in Clients : at[c] = e.at[c] /\ sw[c] = e.sw[c]) /\ UNCHANGED vars
      [] OTHER -> FALSE

\* What the room held after the event is what the spec holds after the action.
Observed(e) == e.event # "Settled" => \A m \in Maps : room'[m] = (IF m \in DOMAIN e.room THEN e.room[m] ELSE Nil)

Silent ==
    \/ \E c \in Clients : /\ writes[c] < Len(Wrote(c))
                          /\ at[c] = Wrote(c)[writes[c] + 1].m
                          /\ Write(c, Wrote(c)[writes[c] + 1].v)
    \/ \E c \in Clients, m \in Maps : Move(c, m)
    \/ \E c \in Clients : GetsAck(c) \/ GetsWrite(c) \/ SkipsWrite(c) \/ GetsTable(c)
    \/ \E c \in Clients : Notices(c) \/ Reconnects(c)

TraceNext ==
    \/ /\ l < Len(Trace)
       /\ Step(Trace[l + 1])
       /\ Observed(Trace[l + 1])
       /\ l' = l + 1
    \/ /\ l < Len(Trace)
       /\ Silent
       /\ l' = l

TraceSpec == TraceInit /\ [][TraceNext]_<<vars, l>>

\* fcheck: the whole trace was consumed.
TraceAccepted == l = Len(Trace)
=============================================================================
