/**
 * A comma-separated list of issue identifiers as an issue list.
 *
 * The path is the filter. There is no saved view to own, no label to apply, and no team
 * to pin the heading to — just the identifiers someone put in a URL so a short review
 * list can be shared without creating anything.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { adhocListTitle, parseAdhocIdentifiers } from '~/features/issue/adhocList';

import { IssueList, type IssueListSource } from './IssueList';

export function AdHocIssues() {
  const navigate = useNavigate();
  const { identifiers = '' } = useParams<{ identifiers: string }>();
  const tokens = useMemo(() => parseAdhocIdentifiers(identifiers), [identifiers]);

  const source = useMemo<IssueListSource>(() => ({ kind: 'adhoc', identifiers: tokens }), [tokens]);

  if (tokens.length === 0) {
    return (
      <EmptyState
        title="No issues in this list"
        description="An ad-hoc list is a URL of identifiers, like /issues/ENG-1,ENG-2. Nothing in this path looks like one."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  return <IssueList source={source} heading={adhocListTitle(tokens)} />;
}
