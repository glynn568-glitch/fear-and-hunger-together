--------------------------- MODULE TraceWrites ---------------------------
(* Trace validation for Writes: checks that what the room really did with one key in a test run,
   and what each game held whenever nothing was on the way, is a behavior of the spec.
   room.js traceWrite writes one line per thing the room does with the key when FH_WRITES_TRACE
   names a file and the key (the room's value after it in "room"); test/crossed.js writes the
   Init line and, at each quiet moment, a Settled line with each game's value.
   fcheck sets TRACE_FILE to one .ndjson file per run.

   What a game does by itself (writing, reading the room's answers and the partners' writes,
   noticing its line broke, coming back) never reaches the room's log: Silent. A game's writes
   are the ones the room logged from it, in that order; a write the room never got cannot be
   named here, and the test makes none. *)
EXTENDS Writes, Json, IOUtils, Sequences

Trace == ndJsonDeserialize(IOEnv.TRACE_FILE)

VARIABLE l   \* events consumed so far

\* What game c wrote, in order: the values the room took or refused from it.
Wrote(c) ==
    LET from == SelectSeq(Trace, LAMBDA e : e.event \in {"Takes", "Refuses"} /\ e.who = c)
    IN [i \in 1..Len(from) |-> from[i].v]

\* Line 1 of every trace is {"event":"Init","once":...}: both games in the world, the key unwritten.
TraceInit ==
    /\ Trace[1].event = "Init"
    /\ l = 1
    /\ Init
    /\ once = Trace[1].once

\* One logged event = one action of the spec, with the logged arguments.
Step(e) ==
    CASE e.event = "Takes" -> RoomTakes(e.who) /\ Head(toRoom[e.who]).v = e.v
      [] e.event = "Refuses" -> RoomRefuses(e.who) /\ Head(toRoom[e.who]).v = e.v
      [] e.event = "Asked" -> RoomAsked(e.who)
      [] e.event = "Breaks" -> Breaks(e.who)
      [] e.event = "Settled" -> Settled /\ (\A c \in Clients : val[c] = e.vals[c]) /\ UNCHANGED vars
      [] OTHER -> FALSE

\* What the room held after the event is what the spec holds after the action.
Observed(e) == e.event # "Settled" => room' = e.room

Silent ==
    \/ \E c \in Clients : writes[c] < Len(Wrote(c)) /\ Write(c, Wrote(c)[writes[c] + 1])
    \/ \E c \in Clients : GetsAck(c) \/ GetsWrite(c) \/ SkipsWrite(c)
    \/ \E c \in Clients : GetsTable(c) \/ GetsEmptyTable(c)
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
