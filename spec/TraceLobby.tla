--------------------------- MODULE TraceLobby ---------------------------
(* Trace validation for Lobby: checks that what the room really did in a test run is a
   behavior of the spec. room.js writes one line per action when FH_LOBBY_TRACE names a file
   (room.js trace): the event, who, and what the room then holds ("now").
   fcheck sets TRACE_FILE to one .ndjson file per run.

   The room only sees what reaches it. What a page does by itself (a game begun with no lobby
   on screen, going back to the title, the partner starting its game) is a step the trace
   does not show: Silent. *)
EXTENDS Lobby, Json, IOUtils, Sequences

Trace == ndJsonDeserialize(IOEnv.TRACE_FILE)

VARIABLE l   \* events consumed so far

SetOf(seq) == {seq[i] : i \in DOMAIN seq}

\* Line 1 of every trace is {"event":"Init", ...}: a room just started.
TraceInit ==
    /\ Trace[1].event = "Init"
    /\ l = 1
    /\ Init

\* What the room held after the event is what the spec holds after the action.
\* (Once a run is under way the room keeps no "run": lobbyRun reads it off the run itself.)
Observed(e) ==
    /\ founded' = e.now.founded
    /\ line' = SetOf(e.now.line)
    /\ {x \in People : ready'[x]} = SetOf(e.now.ready)
    /\ {x \in Actors : at'[x] = "in"} = SetOf(e.now.ins)
    /\ ~founded' => run' = e.now.run

\* One logged event = one action of the spec, with the logged arguments.
\* (A partner sent home with the run is already gone when its socket closes.)
Step(e) ==
    CASE e.event = "Connect" -> Connect(e.who)
      [] e.event = "Drop" -> IF conn[e.who] THEN Drop(e.who) ELSE UNCHANGED vars
      [] e.event = "HoldEnds" -> HoldEnds(e.who)
      [] e.event = "ChooseRun" -> ChooseRun(e.run, e.c)
      [] e.event = "Has" -> Has(e.who, e.c)
      [] e.event = "Pick" -> Pick(e.who, e.c)
      [] e.event = "Ready" -> Ready(e.who)
      [] e.event = "Unready" -> Unready(e.who)
      [] e.event = "GoAway" -> GoAway(e.who)
      [] e.event = "Back" -> Back(e.who)
      [] e.event = "Start" -> Start
      [] e.event = "BeginLoad" -> BeginLoad(e.who)
      [] e.event = "GiveUp" -> GiveUp(e.who)
      [] e.event = "Arrive" -> body[e.who] = e.c /\ Arrive(e.who)
      [] e.event = "BackToTitle" -> BackToTitle(e.who)
      [] e.event = "Join" -> Join(e.who)
      [] OTHER -> FALSE

Silent ==
    \/ \E x \in People, c \in Chars : SoloStart(x, c)
    \/ \E x \in People : Quit(x)
    \/ \E x \in People : Bounce(x)
    \/ \E c \in Chars : PartnerLoad(c)
    \/ PartnerRefused

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
