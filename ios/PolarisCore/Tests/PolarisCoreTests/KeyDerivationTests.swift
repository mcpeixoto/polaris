import Foundation
import Testing
@testable import PolarisCore

/// Keys the server refuses are a dead end on the first screen of a fresh install, so these
/// assert against the server's own patterns rather than against what looks reasonable:
///
///   urlKey   ^[a-z0-9][a-z0-9-]{1,47}$   (services/internal/domain/workspace.go:19)
///   teamKey  ^[A-Z][A-Z0-9]{0,7}$        (services/internal/domain/team.go:20)
@Suite("Derived keys are ones the server accepts")
struct KeyDerivationTests {
    private func matchesURLKey(_ value: String) -> Bool {
        value.wholeMatch(of: /[a-z0-9][a-z0-9\-]{1,47}/) != nil
    }

    private func matchesTeamKey(_ value: String) -> Bool {
        value.wholeMatch(of: /[A-Z][A-Z0-9]{0,7}/) != nil
    }

    @Test("ordinary names derive the obvious thing")
    func ordinary() {
        #expect(KeyDerivation.urlKey(from: "Peixoto Labs") == "peixoto-labs")
        #expect(KeyDerivation.teamKey(from: "Engineering") == "ENG")
    }

    @Test("accents fold to ASCII instead of being refused")
    func accents() {
        // Was "café-ltd" / "CAF" — the first is refused outright by the server's ASCII-only
        // pattern, and every accented character used to vanish rather than fold.
        #expect(KeyDerivation.urlKey(from: "Café Ltd") == "cafe-ltd")
        #expect(matchesURLKey(KeyDerivation.urlKey(from: "Café Ltd")))
        #expect(KeyDerivation.teamKey(from: "Ágil") == "AGI")
    }

    @Test("a name that starts with a digit still yields a legal team key")
    func leadingDigit() {
        // "3M Design" used to derive "3MD", which the server refuses: a team key must start
        // with a letter.
        // The digit is dropped and the remaining letters fill the key: MDESIGN -> MDE.
        #expect(KeyDerivation.teamKey(from: "3M Design") == "MDE")
        #expect(matchesTeamKey(KeyDerivation.teamKey(from: "3M Design")))
    }

    @Test("a one-character name is padded rather than refused")
    func singleCharacter() {
        // The pattern demands a second character, so a bare "a" is rejected. A one-letter
        // workspace name is legitimate; padding is ugly and accepted, bare is tidy and not.
        #expect(KeyDerivation.urlKey(from: "A") == "a-1")
        #expect(matchesURLKey(KeyDerivation.urlKey(from: "A")))
    }

    @Test("names with nothing usable derive empty, and the caller must not send that")
    func unusable() {
        // Empty is the honest answer — the screen has to ask rather than invent a key.
        #expect(KeyDerivation.urlKey(from: "!!!").isEmpty)
        #expect(KeyDerivation.teamKey(from: "🎉🎉").isEmpty)
        #expect(KeyDerivation.teamKey(from: "42").isEmpty)
    }

    @Test("every derived key from a realistic name is one the server accepts")
    func realisticNamesAllValidate() {
        let names = [
            "Peixoto Labs", "Acme", "Café Ltd", "3M Design", "A", "北京 Tech",
            "  Spaces  ", "Hyphen-Ated Co", "Ünïcödé", "The Really Very Long Company Name Ltd",
        ]
        for name in names {
            let url = KeyDerivation.urlKey(from: name)
            if !url.isEmpty {
                #expect(matchesURLKey(url), "urlKey \(url.debugDescription) from \(name.debugDescription)")
            }
            let team = KeyDerivation.teamKey(from: name)
            if !team.isEmpty {
                #expect(matchesTeamKey(team), "teamKey \(team.debugDescription) from \(name.debugDescription)")
            }
        }
    }
}
