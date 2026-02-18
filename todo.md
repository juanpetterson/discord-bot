random kick is not working, add logs on the command so I can debug the errors

add command !x4 !x5, after completing, it will show 2 buttons, random teams, random teams heroes
the random team heroes should random balanced heroes positions for each team, hard carry, mid lane, support, hard support, offlane
typing a !x5 or !x4 after it's already one started will join that user to the existing one.
it is possible to type !x5leave or !x4leave to leave the group or even the creator !x4cancel !x5cancel to cancel the current group. also, the creator can type !x5kick nickname to kick someone, it can be the closest nickname when not provided the full one

the bet command should be !bet @ruro (nós/nos) or eles
nós or nos means win
eles means lose
to define the winner provide the match id
example: !bet @ruro nós

create a map of the discord users and steam id to identify the winner. create a fake one, I will populate it correctly later
after betting on a player it should check if the match already started or if there is a current match
should not be possible to bet after 10min on normal/ranked matches or 5min or turbo matches.