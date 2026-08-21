# Search polish (identifier shorthand, stop words, phrases)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** 46 (unchanged)

Typing `ENG-123` or `eng123` finds that issue. Unquoted English glue is dropped. Quotes make a phrase.

## Scope

- A query that is an issue identifier (hyphen optional) resolves by team key + number and returns that issue, or nothing
- `issueByIdentifier("eng1")` is the same spelling as `ENG-1`
- Unquoted stop words (`the`, `a`, `of`, …) are dropped so "the login" searches login
- `"login redirect"` is a tsquery phrase (`<->`); a finished quoted phrase is not a prefix
- Client `searchTerms` drops the same glue and keeps quoted words, so highlights match

## Deferred

- Identifier history after a team-key change (old IDs in search)
- Ranking an identifier hit above FTS when the query is mixed (`ENG-123 login`)
- Stemming / a language dictionary other than `simple`
