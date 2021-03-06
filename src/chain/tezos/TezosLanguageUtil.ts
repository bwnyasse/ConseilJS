import * as Micheline from './lexer/Micheline';
import * as Michelson from './lexer/Michelson';
import * as nearley from 'nearley';

import { TezosMessageUtils } from './TezosMessageUtil';

const primitiveRecordOrder = ["prim", "args", "annots"];

/**
 * A collection of functions to encode and decode Michelson and Micheline code
 */
export namespace TezosLanguageUtil {
    /**
     * Parse out a single message from a hex string.
     * @param {string} hex
     * @returns {codeEnvelope} Parsed Micheline object as a string along with the number of bytes that was consumed in the process.
     */
    export function hexToMicheline(hex: string): codeEnvelope {
        if (hex.length < 2) { throw new Error(`Malformed Micheline fragment '${hex}'`); }
        let code = '';
        let offset = 0;
        let fieldType = hex.substring(offset, offset + 2);
        offset += 2;

        try {
            switch (fieldType) {
                case '00': { // literal int or nat
                    const value = TezosMessageUtils.findInt(hex.substring(offset), 0, true);
                    code += `{ "int": "${value.value}" }`;
                    offset += value.length;
                    break;
                }
                case '01': { // literal string
                    const stringEnvelope = michelineHexToString(hex.substring(offset));
                    code += `{ "string": "${stringEnvelope.code}" }`;
                    offset += stringEnvelope.consumed;
                    break;
                }
                case '02': { // array
                    const length = parseInt(hex.substring(offset, offset + 8), 16);
                    offset += 8;
                    let buffer: string[] = [];
                    let consumed = 0;
                    while (consumed < length) {
                        let envelope = hexToMicheline(hex.substring(offset));
                        buffer.push(envelope.code);
                        consumed += envelope.consumed / 2; // plain bytes
                        offset += envelope.consumed; // hex-encoded two-char bytes
                    }
                    if (length === 0) {
                        code += '[]';
                    } else {
                        code += `[ ${buffer.join(', ')} ]`;
                    }
                    break;
                }
                case '03': { // bare primitive
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)} }`;
                    offset += 2;
                    break;
                }
                case '04': { // primitive with a set of annotations
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)}, `;
                    offset += 2;

                    const annEnvelope = hexToAnnotations(hex.substring(offset));
                    code += `"annots": [ ${annEnvelope.code} ] }`;
                    offset += annEnvelope.consumed;
                    break;
                }
                case '05': { // primitive with an argument
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)}, `;
                    offset += 2;
                    const envelope = hexToMicheline(hex.substring(offset));
                    code += `"args": [ ${envelope.code} ] }`;
                    offset += envelope.consumed;
                    break;
                }
                case '06': { // primitive with an argument an a set of annotations
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)}, `;
                    offset += 2;

                    const args = hexToMicheline(hex.substring(offset));
                    code += `"args": [ ${args.code} ], `;
                    offset += args.consumed;

                    const anns = hexToAnnotations(hex.substring(offset));
                    code += `"annots": [ ${anns.code} ] }`;
                    offset += anns.consumed;
                    break;
                }
                case '07': { // primitive with two arguments
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)}, `;
                    offset += 2;

                    let buffer: string[] = [];
                    let envelope = hexToMicheline(hex.substring(offset));
                    buffer.push(envelope.code);
                    offset += envelope.consumed;
                    envelope = hexToMicheline(hex.substring(offset));
                    buffer.push(envelope.code);
                    offset += envelope.consumed;

                    code += `"args": [ ${buffer.join(', ')} ] }`;
                    break;
                }
                case '08': { // primitive with two arguments and an annotation set
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)}, `;
                    offset += 2;

                    const arg0 = hexToMicheline(hex.substring(offset));
                    offset += arg0.consumed;
                    const arg1 = hexToMicheline(hex.substring(offset));
                    offset += arg1.consumed;
                    code += `"args": [ ${arg0.code}, ${arg1.code} ], `;

                    const anns = hexToAnnotations(hex.substring(offset));
                    code += `"annots": [ ${anns.code} ] }`;
                    offset += anns.consumed;
                    break;
                }
                case '09': { // primitive with an argument array and an optional anotation set
                    code += `{ "prim": ${hexToMichelineKeyword(hex, offset)}, `;
                    offset += 2;

                    let envelope = hexToMicheline('02' + hex.substring(offset)); // fake an array to re-use the parsing code
                    code += `"args": ${envelope.code}`;
                    offset += envelope.consumed - 2; // account for the inserted '02' above

                    if (hex.substring(offset, offset + 8) !== '00000000') {
                        const annEnvelope = hexToAnnotations(hex.substring(offset));
                        if (annEnvelope.code.length > 2) { // more than empty quotes
                            code += `, "annots": [ ${annEnvelope.code} ] }`;
                        }
                        offset += annEnvelope.consumed;
                    } else {
                        code += ' }';
                        offset += 8;
                    }
                    break;
                }
                case '0a': { // raw bytes
                    const length = parseInt(hex.substring(offset, offset + 8), 16);
                    offset += 8;
                    code += `{ "bytes": "${hex.substring(offset, offset + length * 2)}" }`;
                    offset += length * 2;
                    break;
                }
                default: { throw new Error(`Unknown Micheline field type '${fieldType}' at offset ${offset} of '${hex}'`); }
            }
        } catch (err) {
            const m = `Nested hex parsing error (${err.message}) after: ${hex}, ${offset}, ${code}`;
            throw new Error(m);
        }

        return { code: code, consumed: offset };
    }

    export function hexToMichelson(hex: string): codeEnvelope {
        if (hex.length < 2) { throw new Error(`Malformed Michelson fragment '${hex}'`); }
        let code = '';
        let offset = 0;
        let fieldType = hex.substring(offset, offset + 2);
        offset += 2;

        try {
            switch (fieldType) {
                case '00': { // literal int or nat
                    const value = TezosMessageUtils.findInt(hex.substring(offset), 0, true);
                    code += `${value.value}`;
                    offset += value.length;
                    break;
                }
                case '01': { // literal string
                    const stringEnvelope = michelineHexToString(hex.substring(offset));
                    code += `"${stringEnvelope.code}"`;
                    offset += stringEnvelope.consumed;
                    break;
                }
                case '02': { // array
                    const length = parseInt(hex.substring(offset, offset + 8), 16);
                    offset += 8;
                    let buffer: string[] = [];
                    let consumed = 0;
                    while (consumed < length) {
                        let envelope = hexToMichelson(hex.substring(offset));
                        buffer.push(envelope.code);
                        consumed += envelope.consumed / 2; // plain bytes
                        offset += envelope.consumed; // hex-encoded two-char bytes
                    }
                    if (length === 0) {
                        code += '[]';
                    } else {
                        code += `[ ${buffer.join(' ')} ]`;
                    }
                    break;
                }
                case '03': { // bare primitive
                    code += `( ${hexToMichelsonKeyword(hex, offset)} )`;
                    offset += 2;
                    break;
                }
                case '04': { // primitive with a set of annotations
                    code += `( ${hexToMichelsonKeyword(hex, offset)} `;
                    offset += 2;
        
                    const annEnvelope = hexToAnnotations(hex.substring(offset), false);
                    code += ` ${annEnvelope.code} )`;
                    offset += annEnvelope.consumed;
                    break;
                }
                case '05': { // primitive with an argument
                    code += `( ${hexToMichelsonKeyword(hex, offset)} `;
                    offset += 2;
                    const envelope = hexToMichelson(hex.substring(offset));
                    code += ` ${envelope.code} )`;
                    offset += envelope.consumed;
                    break;
                }
                case '06': { // primitive with an argument an a set of annotations
                    code += `( ${hexToMichelsonKeyword(hex, offset)} `;
                    offset += 2;
        
                    const args = hexToMichelson(hex.substring(offset));
                    code += ` ${args.code} `;
                    offset += args.consumed;
        
                    const anns = hexToAnnotations(hex.substring(offset), false);
                    code += ` ${anns.code} )`;
                    offset += anns.consumed;
                    break;
                }
                case '07': { // primitive with two arguments
                    code += `( ${hexToMichelsonKeyword(hex, offset)} `;
                    offset += 2;
        
                    let buffer: string[] = [];
                    let envelope = hexToMichelson(hex.substring(offset));
                    buffer.push(envelope.code);
                    offset += envelope.consumed;
                    envelope = hexToMichelson(hex.substring(offset));
                    buffer.push(envelope.code);
                    offset += envelope.consumed;
        
                    code += ` ${buffer.join(' ')} )`;
                    break;
                }
                case '08': { // primitive with two arguments and an annotation set
                    code += `( ${hexToMichelsonKeyword(hex, offset)} `;
                    offset += 2;
        
                    const arg0 = hexToMichelson(hex.substring(offset));
                    offset += arg0.consumed;
                    const arg1 = hexToMichelson(hex.substring(offset));
                    offset += arg1.consumed;
                    code += ` ${arg0.code} ${arg1.code} `;
        
                    const anns = hexToAnnotations(hex.substring(offset), false);
                    code += ` ${anns.code} )`;
                    offset += anns.consumed;
                    break;
                }
                case '09': { // primitive with an argument array and an optional annotation set
                    code += `( ${hexToMichelsonKeyword(hex, offset)} `;
                    offset += 2;
        
                    let envelope = hexToMichelson('02' + hex.substring(offset)); // fake an array to re-use the parsing code
                    code += `"args": ${envelope.code}`;
                    offset += envelope.consumed - 2; // account for the inserted '02' above
        
                    if (hex.substring(offset, offset + 8) !== '00000000') {
                        const annEnvelope = hexToAnnotations(hex.substring(offset), false);
                        if (annEnvelope.code.length > 2) { // more than empty quotes
                            code += ` ${annEnvelope.code} )`;
                        }
                        offset += annEnvelope.consumed;
                    } else {
                        code += ' )';
                        offset += 8;
                    }
                    break;
                }
                case '0a': { // raw bytes
                    const length = parseInt(hex.substring(offset, offset + 8), 16);
                    offset += 8;
                    code += `0x${hex.substring(offset, offset + length * 2)}`;
                    offset += length * 2;
                    break;
                }
                default: { throw new Error(`Unknown Michelson field type '${fieldType}' at offset ${offset} of '${hex}'`); }
            }
        } catch (err) {
            const m = `Nested hex parsing error (${err.message}) after: ${hex}, ${offset}, ${code}`;
            throw new Error(m);
        }

        return { code: code, consumed: offset };
    }

    /**
     * Converts Michelson to Micheline and wraps the result in a script property.
     */
    export function translateMichelsonToMicheline(code: string): string {
        const parser = new nearley.Parser(nearley.Grammar.fromCompiled(Michelson.default));
        preProcessMichelsonScript(code).forEach(p => { parser.feed(p); });

        return parser.results[0];
    }

    /**
     * Converts simple (read non-lambda) Michelson parameters to Micheline and wraps the result in a script property.
     */
    export function translateParameterMichelsonToMicheline(code: string): string {
        return translateMichelsonToMicheline(code);
    }

    /**
     * Convenience function to take Michelson contract straight to hex, calls translateMichelsonToMicheline() then translateMichelineToHex() internally.
     *
     * @param {string} code Michelson code string
     * @returns {string} hex-encoded contract content
     */
    export function translateMichelsonToHex(code: string): string {
        return preProcessMicheline(translateMichelsonToMicheline(code))
            .map(p => { var c = normalizeMichelineWhiteSpace(p); return c; } )
            .map(p => translateMichelineToHex(p))
            .reduce((m, p) => { return m + ('0000000' + (p.length / 2).toString(16)).slice(-8) + p; }, '');
    }

    function preProcessMicheline(code: string): string[] {
        const container = JSON.parse(code);
        let parts: string[] = [];

        parts.push(getSection(container, 'code'));
        parts.push(getSection(container, 'storage'));

        return parts;
    }

    function getSection(container: any, key: string): string {
        let root = container;
        if (!!container.script) { root = container.script; }

        for (let i = 0; i < root.length; i++) {
            if (root[i]['prim'] === key) {
                return JSON.stringify(root[i], null, 1);
            }
        }

        throw new Error(`${key} key was not found`);
    }

    /**
     * Translate Micheline fragment into hex. Resulting hex string may need to be processed further before being submitted to the server.
     */
    export function translateMichelineToHex(code: string): string {
        const parser = new nearley.Parser(nearley.Grammar.fromCompiled(Micheline.default));
        parser.feed(normalizeMichelineWhiteSpace(code));
        return parser.results.join('');
    }

    /**
     * Converts a Micheline-encoded ASCII string from hex. First 4 bytes are treated as length, followed by n-byte string.
     */
    function michelineHexToString(hex: string): codeEnvelope {
        let offset = 0;
        const length = parseInt(hex.substring(offset, offset + 8), 16);
        offset += 8;
        const text = Buffer.from(hex.substring(offset, offset + length * 2), 'hex').toString();
        offset += length * 2
        return { code: text, consumed: offset };
    }

    /**
     * Translated a plain hex-encoded int into a Michelson/Micheline keyword.
     *
     * @param hex Hex-encoded contract to process
     * @param offset Offset to read one byte from
     * @returns {string} Michelson/Micheline keyword
     */
    function hexToMichelineKeyword(hex: string, offset: number): string {
        return Micheline.getKeywordForCode(parseInt(hex.substring(offset, offset + 2), 16));
    }

    function hexToMichelsonKeyword(hex: string, offset: number): string {
        return hexToMichelineKeyword(hex, offset).slice(1, -1);
    }

    /**
     * Translates hex-encoded stream into a collection of annotations. Determines the length internally. Annotations are prefixed with ':', '@', or '%' for type, variable, and field annotations.
     *
     * @param {string} hex Hex-encoded contract fragment to process
     * @returns {codeEnvelope} Parsed annotations and the number of consumed bytes.
     * @see [Michelson Annotations]{@link https://tezos.gitlab.io/whitedoc/michelson.html#annotations}
     */
    function hexToAnnotations(hex: string, quote: boolean = true): codeEnvelope {
        const stringEnvelope = michelineHexToString(hex);

        return {
            code: (quote ? stringEnvelope.code.split(' ').map(s => `"${s}"`).join(', ') : stringEnvelope.code),
            consumed: stringEnvelope.consumed
        };
    }

    /**
     * This function is undocumented, if you're using it, please know what you're doing.
     */
    export function overrideKeywordList(list: string[]) {
        Micheline.setKeywordList(list);
    }

    export function restoreKeywordList() {
        Micheline.setKeywordList(Micheline.DefaultMichelsonKeywords);
    }

    /**
     * Reformats the Michelson code into the order the parser will understand. Input is expected to contains parameter, storage and code sections.
     */
    export function preProcessMichelsonScript(code: string): string[] {
        let sections = new Map<string, any>();
        sections['parameter'] = code.search(/(^|\s+)parameter/m);
        sections['storage'] = code.search(/(^|\s+)storage/m);
        sections['code'] = code.search(/(^|\s+)code/m);

        const boundaries = Object.values(sections).sort((a, b) => Number(a) - Number(b) );
        sections[Object.keys(sections).find(key => sections[key] === boundaries[0]) + ''] = code.substring(boundaries[0], boundaries[1]);
        sections[Object.keys(sections).find(key => sections[key] === boundaries[1]) + ''] = code.substring(boundaries[1], boundaries[2]);
        sections[Object.keys(sections).find(key => sections[key] === boundaries[2]) + ''] = code.substring(boundaries[2]);

        const parts: string[] = [sections['parameter'], sections['storage'], sections['code']];

        return parts.map(p => p.trim().split('\n').map(l => l.replace(/\#[\s\S]+$/, '').trim()).filter(v => v.length > 0).join(' '));
    }

    /**
     * This util function is used to ensure the correct order in primitive records before parsing it.
     *
     * Micheline parser expects the following JSON order { prim: ..., args: ..., annots: ... }
     */
    export function normalizePrimitiveRecordOrder(obj: object)  {
        if (Array.isArray(obj)) {
            return obj.map(normalizePrimitiveRecordOrder);
        }

        if (typeof obj === "object") {
            return Object.keys(obj)
                .sort((k1, k2) => primitiveRecordOrder.indexOf(k1) - primitiveRecordOrder.indexOf(k2))
                .reduce((newObj, key) => ({
                    ...newObj,
                    [key]: normalizePrimitiveRecordOrder(obj[key])
                }), {});
        }
        return obj;
    }

    /**
     * Micheline parser expects certain whitespace arrangement, this function will correct the input string accordingly.
     */
    export function normalizeMichelineWhiteSpace(fragment: string): string {
        return fragment.replace(/\n/g, ' ')
            .replace(/ +/g, ' ')
            .replace(/\[{/g, '[ {')
            .replace(/}\]/g, '} ]')
            .replace(/},{/g, '}, {')
            .replace(/\]}/g, '] }')
            .replace(/":"/g, '": "')
            .replace(/":\[/g, '": [')
            .replace(/{"/g, '{ "')
            .replace(/"}/g, '" }')
            .replace(/,"/g, ', "')
            .replace(/","/g, '", "')
            .replace(/\[\[/g, '[ [')
            .replace(/\]\]/g, '] ]')
            .replace(/\["/g, '\[ "')
            .replace(/"\]/g, '" \]')
            .replace(/\[ +\]/g, '\[\]')
            .trim();
    }

    export function normalizeMichelsonWhiteSpace(fragment: string): string {
        return fragment.replace(/\s{2,}/g, ' ')
            .replace(/\( /g, '(')
            .replace(/ \)/g, ')')
    }

    /**
     * 
     * 
     * @param fragment 
     */
    export function stripComments(fragment: string): string {
        return fragment.trim().split('\n').map(l => l.replace(/\#[\s\S]+$/, '').trim()).filter(v => v.length > 0).join(' ');
    }

    interface codeEnvelope {
        code: string,
        consumed: number
    }
}
