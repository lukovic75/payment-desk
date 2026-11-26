/** IBAN helpers: normalisation, country length and the ISO 13616 mod-97 checksum. No network, no guessing. */

/** IBAN length per country (ISO 13616 registry) for the countries a European payables desk meets. */
export const IBAN_LENGTH: Record<string, number> = {
	AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27,
	LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, ME: 22, MK: 19, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, RS: 22, SE: 24, SI: 19, SK: 24, SM: 27,
}

export function normalizeIban(raw: string): string {
	return raw.replace(/\s+/g, "").toUpperCase()
}

export function formatIban(iban: string): string {
	return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim()
}

export function isValidIban(raw: string): boolean {
	const iban = normalizeIban(raw)
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
	const expected = IBAN_LENGTH[iban.slice(0, 2)]
	if (expected && iban.length !== expected) return false
	const rearranged = iban.slice(4) + iban.slice(0, 4)
	const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
	let remainder = 0
	for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97
	return remainder === 1
}

/**
 * IBANs written in a piece of text, read character by character from the text itself. A match is cut to the
 * country's length when the country is known, so words that follow on the same line are not swallowed.
 */
export function ibansIn(text: string): string[] {
	const out: string[] = []
	for (const m of text.toUpperCase().matchAll(/(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[  ]?[A-Z0-9]){11,30}/g)) {
		const raw = m[0].replace(/[\s ]+/g, "")
		const length = IBAN_LENGTH[raw.slice(0, 2)]
		out.push(length && raw.length >= length ? raw.slice(0, length) : raw)
	}
	return [...new Set(out)]
}
