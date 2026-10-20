# Stats

Interview stats: a dashboard of the search, and what hunt uses of its
machine.

## The dashboard

What's coming up first, then:

- active applications, and how far they got through the stages;
- what was added, and how many interviews, each week;
- why processes ended, and which sources get furthest;
- how they'd work, and pay on the table (in the home currency);
- how long things take, and activity day by day;
- what's gone quiet, and the records kept, table by table.

Every chart's numbers are also a table.

## System resources

What hunt uses of its machine, refreshed every 5 seconds while the page is
open (`GET /api/system`):

- memory (against the container's limit, on Linux);
- CPU now and on average, and load;
- the database's size and stored files, and the free space on its disk
  (SQLite).

"Up for" counts across restarts and rollouts: hunt keeps a heartbeat each
minute in its database, and a start less than 15 minutes after the last
one carries the uptime on.
