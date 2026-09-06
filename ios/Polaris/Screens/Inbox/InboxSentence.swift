import Foundation
import PolarisCore

/// What an inbox row says happened, with the person who did it where there is one.
///
/// `PolarisNotificationType.summary` is the actor-less form — "Assigned to you" — which is
/// right when the actor is an integration or the system and wrong when it is Ana: Linear's
/// inbox reads "Ana assigned you", and a row that hides who did it sends the reader into the
/// issue to find out. One sentence per type, so a type this build knows is never reduced to
/// "Update".
enum InboxSentence {
    static func text(for notification: PolarisNotification, actor: User?) -> String {
        text(type: notification.type, count: notification.count, actor: actor?.displayName)
    }

    static func text(type: PolarisNotificationType, count: Int = 1, actor: String?) -> String {
        guard let who = actor, !who.isEmpty else { return summaryWithCount(type, count: count) }
        switch type {
        case .issueAssigned: return String(localized: "\(who) assigned you")
        case .issueStatusChanged: return String(localized: "\(who) changed the status")
        case .issuePriorityRaised: return String(localized: "\(who) raised the priority")
        case .issueDue: return String(localized: "Due soon")
        case .issueBlocked: return String(localized: "\(who) marked it blocked")
        case .comment:
            return count > 1
                ? String(localized: "\(who) and others commented · \(count)")
                : String(localized: "\(who) commented")
        case .mention: return String(localized: "\(who) mentioned you")
        case .subIssueCompleted: return String(localized: "\(who) completed a sub-issue")
        case .viewIssueAdded: return String(localized: "\(who) added this to a view you follow")
        case .viewIssueCompleted: return String(localized: "\(who) completed this in a view you follow")
        case .pulseDigest: return String(localized: "Your project digest")
        case .projectIssueAdded: return String(localized: "\(who) added this to a project you follow")
        case .projectIssueCompleted: return String(localized: "\(who) completed this in a project you follow")
        case .projectUpdate: return String(localized: "\(who) posted a project update")
        case .initiativeIssueAdded: return String(localized: "\(who) added this to an initiative you follow")
        case .initiativeIssueCompleted: return String(localized: "\(who) completed this in an initiative you follow")
        case .initiativeUpdate: return String(localized: "\(who) posted an initiative update")
        case .customerRequestAdded: return String(localized: "\(who) added a customer request")
        case .customerRequestImportant: return String(localized: "\(who) marked a customer request important")
        case .customerRequestCompleted: return String(localized: "\(who) completed a customer request")
        case .other: return String(localized: "\(who) updated this")
        }
    }

    /// The actor-less sentence, with the collapse count where several events became one row.
    private static func summaryWithCount(_ type: PolarisNotificationType, count: Int) -> String {
        count > 1 ? "\(type.summary) · \(count)" : type.summary
    }
}
