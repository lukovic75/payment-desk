/** IBAN helpers: normalisation and the ISO 13616 mod-97 checksum. No network, no guessing. */

export function normalizeIban(raw: string): string {
	return raw.replace(/\s+/g, "").toUpperCase()
}

export function formatIban(iban: string): string {
	return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim()
}

export function isValidIban(raw: string): boolean {
	const iban = normalizeIban(raw)
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
	const rearranged = iban.slice(4) + iban.slice(0, 4)
	const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
	let remainder = 0
	for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97
	return remainder === 1
}
