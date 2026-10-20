// The data models powering this tool
//
// First, Entitites:
//
//  - Hunt: a wave or phase of job hunting.
//      - i.e. after leaving FB there was a Hunt phase that ended when I joined Neon, and another
//      one is starting now for a post-Databricks world
//      - A Hunt has a Preference or more
//      - A Hunt is the top level struct
//      - A Hunt can capture overall stats and other context and info
//  - Preference: Captures my preferences (e.g. remote, TC, etc)
//      - Can be used to sort and filter Role Can be used to sort and filter Role
//  - Role: captures details about a specific opening
//  - RoleRemoteStatus
//  - RoleRemoteStatus
//  - Company: hiring company, or a 3rd party involved in the process
//  - Person: like a recruiter, a hiring manager, interviwer, etc
//  - Lead: captures a specific opportunity
//      - A Company can have multiple Leads
//      - A Lead can have children Leads (e.g. an external recruiter is a Lead, and can generate
//      more than one Lead with more than one Company)
//      - A Lead can be linked to multiple People
//  - InterviewStep: a specific interview step (e.g. hiring manager call, or screening)
//  - InterviewProcess: captures a specific hiring process/flow for a specific Lead
//      - A InterviewProcess can have 0 or more InterviewStep
//      - A InterviewProcess can have a relationship with 0 or more Person
//  - PersonRole: captures the role of a specific Person in a specific InterviewProcess
//      - can be linked to an InterviewProcess and/or an InterviewStep
//  - InterviewStepStatus: captures the status of a specific InterviewStep
//  - Funnel: a way to organise Leads and InterviewProcess into a timeline
//      - FunnelStage: (e.g. considering, applied, rejected, abandoned, etc.)
//  - Task: something I need to do, e.g. apply, follow up, respond to email,  take home task, etc.)
//      - can be linked to amost any other Struct
//  - Artifact: resume versions and other submitted files
//  - Offer: in case an InterviewProcess was succcesful, what Offer did I receive?
//  - Decision: captures a transition decision for InterviewProcess and InterviewStep
//      - Can be a progressing Decision, like moving to the next step
//      - Can be a terminating decision, like accepting offer, or being rejected.
//      - Can also have a "timeout" for stale processes that can be dropped.
//
//
//
//  - Note: captures my free form notes.
//      - Can be linked to one or more of almost any of the above Objects
//
//
//
//  Here is the `hunt --help` output for futher tuning and inspiration:
//
//          usage: hunt [-h] [--db DB] {add,log,correct,list,today,stale,show,funnel,export,import,artifacts,contacts} ...
//
//          Track a job search. Docs: docs/problem.md, docs/design.md
//
//          positional arguments:
//            {add,log,correct,list,today,stale,show,funnel,export,import,artifacts,contacts}
//              add                 track a new opportunity
//              log                 record an event
//              correct             supersede an event with a corrected one
//              list                live opportunities (C1)
//              today               what I owe, by due date (C2)
//              stale               what they owe me and are overdue on (C2)
//              show                full history of one opportunity (C3)
//              funnel              stage reached per source or resume (C6)
//              export              dump everything (C7)
//              import              load a JSON export into an empty database
//              artifacts           resume versions and other submitted files
//              contacts            people, optionally for one opportunity
//
//          options:
//            -h, --help            show this help message and exit
//            --db DB               database file (default: $HUNT_DB or ~/.hunt/hunt.db)
