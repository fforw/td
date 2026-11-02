import { rng } from "./util";

type RuleSet = {
    startLetters: string[],
    letterStats: { [k : string] : string[]},
    terminals: { [k : string] : true },
}

export const PEOPLE : RuleSet = {
    startLetters : ["c","m","p","l","e","j","t","m","t","l","a","l","e","j","s","l","a","m","l","l","e","n","a","o","n","z","j","j","p","a","e","m","s","a","l","l","m","l","j","j","n","c","l","f","l","l","m","l","m","y","l","s","e","m","j","d","b","b","a","v","a","f","f","v","l","l","h","f","m","e","k","m","l","n","a","s","a","s","l","j","e","h","l","e","l","m","l","s","g","l","m","m","o","m","l","m","j","j","n","k","m","l","m","n","e","n","l","e","j","j","m","j","n","l","e","m","l","m","l","t","m","f","p","t","m","a","s","i","k","s","c","m","p","l","h","i","l","j","i","j","f","k","d","n","l","n","t","n","e","n","l","s","m","s","j","h","c","d","s","j","l","m","t","r"],
    letterStats : {"C":["l","a","a","o"],"l":["a","i","d","a","e","e","i","a","i","i","i","i","a","i","i","e","a","o","i","e","a","e","i","i","s","s","i","o","a","o","a","a","e","i","a","i","a","y","e","i","a"],"a":["r","r","u","k","t","r","r","t","u","d","r","n","s","h","r","s","n","m","m","b","n","s","u","y","r","x","s","r","h","m","t","n","n","r","n","r","r","r","r","r","n","r","t","s","n","n","j","x","n","u","s","m","l","b","r","r","t","m","b","n","n","v","s","s","n","n","s","r","n","f","e"],"r":["a","i","d","o","i","a","i","l","i","a","y","l","a","i","l","e","a","i","a","l","a","l","i","i","j","l","l","i","e","a","a","i","d"],"M":["a","a","a","a","i","i","e","e","a","a","a","i","a","a","a","e","a","a","o","o","a","i","a","i","i"],"i":["a","n","m","l","s","a","k","a","n","c","a","k","e","n","n","s","l","s","s","n","e","s","n","s","n","k","n","k","a","k","a","n","n","o","l","a","a","k","e","k","e","s","a","e","k","a","l","s","c","a","e","s","l","n","l","l","e","t","s","s","m","a","a","r","m","a","a","n","u","a","e","n","d","c","e","c","l","n","a","r","a","n","e","e","n","l","l"],"P":["a","a","a","i"],"u":["l","i","l","n","a","i","i","k","r","e","k","i","l","c","i","i","l","s","l","s","l","c","c","l"],"n":["e","y","a","a","o","a","t","i","a","a","a","i","a","a","a","i","i","j","i","j","c","t","r","a","t","a","a","e","d","i","i","a","e","a","u","s","t","a","r","i","a"],"L":["y","e","o","e","e","e","e","u","e","e","i","o","u","o","u","a","i","u","e","o","e","e","a","i","i","u","u","u","i","i","u","u","e"],"y":["a","a"],"E":["v","l","m","r","l","m","r","m","l","m","m","m"],"v":["a","i"],"J":["a","o","o","o","o","o","a","o","a","u","a","a","o","u","u","u","a"],"k":["o","o","a","t","a","a","l","a","a"],"o":["b","m","u","e","f","n","n","x","n","e","n","h","n","n","n","s","a","u","t","p","m","r","n","n","n","u","n","s","r","s","r","b","m","n","n","n","r","p","l","f"],"T":["i","o","h","o","e","i"],"t":["i","e","o","a","o","o","a","e","a","i","z","s","a","i","i"],"d":["a","s","r","a","e","a","a"],"e":["n","l","o","o","n","n","e","l","o","o","o","l","l","n","n","n","n","l","l","a","l","n","a","r","l","t","n","l","r","l","f","s","o","l","l","n","l","d","r","s","b","n","l","n","l"],"A":["n","a","n","l","d","d","n","n","m","m"],"s":["a","h","e","a","m","a","k","a","e","a","e","e","a","a","t","a","t","m"],"S":["o","a","o","a","a","t","a","i","o","e","o"],"f":["i","i","i","a"],"m":["a","i","i","i","i","e","u","e","i","i","y","o","o","i","i"],"N":["i","e","o","i","e","i","i","i","i","i","o","i"],"O":["l","s"],"Z":["o"],"h":["n","u","i","e","i"],"F":["i","a","i","i","l","r"],"Y":["a"],"p":["h","h"],"D":["o","a","a"],"B":["e","e"],"j":["a","a","a","a"],"V":["i","i"],"b":["i","i","e","e","a"],"c":["e","o","a","k","i","l","y"],"H":["e","a","e","e"],"K":["a","l","a","o"],"G":["r"],"x":["i"],"I":["s","d","s"],"R":["a"]},
    terminals : {"a":true,"e":true,"b":true,"m":true,"y":true,"l":true,"d":true,"n":true,"o":true,"x":true,"c":true,"s":true,"h":true,"k":true,"t":true,"r":true,"i":true,"z":true}
};

export const CITIES : RuleSet = {
    startLetters: ["r","m","n","t","f","s","p","c","g","b","b","v","p","c","v","m","c","c","t","p","t","b","r","t","m","p","l","l","f","p","r","f","s","s","u","b","t","b","n","a","s","c","a","m","a","p","r","l","b","c","c","s","c","o","a","v","p","s","c","v","g","r","g","b","m","s","l","v","b","c","o","m","p","e","l","v","v","t","p","p","m","v","r","a","f","n","a","m","p","r","f","i","t","i","t","t","r","t","s","l","b","c","c","a","a","c","t","v","f","l","c","m","l","p","p","l","b","a"],
    letterStats: {"R":["o","e","a","a","i","i","e","o"],"o":["m","r","a","l","g","n","m"," ","d","r","g","v","n","p","l","t","t","n","b","s"," ","v","n","r","s","l","n","v","n","r","i"," ","s","n","r","l"," ","v","n","s","l","r","n","r","n","d"],"m":["e","o","o","o","a","p","o","i","o","i","p","p","o"],"M":["i","e","o","a","a","a","o","a","a"],"i":["l","n","a","a","c","n","e","s","o"," ","a","s","v","a","a","r","n","n","s","l","v","t","a","e","a","b","a","s","c","z","a","e","n","s","t","l","d","a","a","a","m","n","a","a","s","a","o","l","a","n","a","a","o","a","g","o","e"," ","c","n","e","a","a","a","g"],"l":["a","e","o","e","e","o","i","a","e","z","a","a","b","e","t","z","u","l","i","l","u","l","a","e","i","ì","e","l","a","i","l","i","ì"],"a":["n","p","l","l","t","n","r","r","g","r","s","r","n","m","l","b","r","v","r","c","s","r","r","r","b","n","t","n","r","r","l","g","v","m","s","l","d","v","l","n","n","s","n","t","n","n","t","c","n","v","c","n","n","t","s","u","n","p","n","m","n","r","r","c","t"," ","r"],"N":["a","o","u"],"p":["l","r","o","e","i","a","e"],"e":["s","n","r","r","n","r","s","n","s","r","s","r","g","v","n","c","r","n","r","t","n","z","n","n","v","n","c","n","n","t","n","t","t","r","l","l","m","r","n","r","r","s","r","g","r","s","m","r","i","l","n","o","n","l","t","r","s","c","r","z","s","n","s","n"],"T":["u","r","a","r","r","r","o","e","r","e","e"],"u":["r","g","s","s","i","r","n","c","o","s","s","n"],"r":["i","e","n","m","i","o","a","i","t","i","a","g","i","e","m","n","u","r","a","a","a","i","l","e","i","a","a","o","e","s","o","i","o","i","c","e","i","a","b","o","a","b","i","m","o","i","a","o","i","t","a","a","i","n","e","l","b","a","o","d","e","i"],"F":["l","o","e","e","r","o"],"n":["c","o","i","o","a","a","i","a","t","a","o","n","a","e","t","d","c","a","o","z","z","e","t","e","a","t","a","i","z","o","l","a","o","a","o","t","n","a","i","z","z","i","i","d","d","o","e","i","i","d","u","z","e","o","o","i","i","o","e","t"],"c":["e","a","e","c","e","u","o","c","h","e","e","c","a","i","e","o","e","c","o","e","i"],"S":["a","i","a","o","i","a","a","o","p"],"P":["a","e","i","a","e","o","a","r","a","i","i","a","i","e","o"],"C":["a","a","o","a","a","a","i","r","a","a","r","o","u","h","a"],"t":["a","a","e","o","t","a","o","a","i","e","o","a","o","a","i","a","t","a","i","o","i","a","o","o","e","e","o","o","i","a","o"],"G":["e","o","r"],"B":["a","o","e","a","r","e","o","e","i","r"],"g":["n","l","a","g","i","g","i","i","u","g","i","l","o","r","e"],"V":["e","e","i","a","i","e","i","i","e","a"],"s":["c","s","i","e","t","a","o","a","s","a","i","a","t","a","s","o","t","s","e","s","e","s","a","t","s","a","t","i","i","a","e","e","c","e","a","c"]," ":["d","c","v","e","p","p","s"],"d":["i","e","i","i","o","r","r","r","r","e","i"],"b":["r","o","a","i","o","o","a","o"],"v":["i","o","e","a","e","i","e","a","o","a","i","i","e"],"L":["e","i","’","a","u","a","e","a","o"],"U":["d"],"A":["n","r","s","q","o","n","l","s","v","g"],"z":["a","a","z","o","a","a","i","a","a","a","a","i"],"’":["a"],"q":["u"],"h":["i","i"],"O":["l","r"],"E":["n","m"],"I":["m","g"]},
    terminals: {"e":true,"n":true,"s":true,"o":true,"a":true,"i":true,"ì":true}
};


function choice(a : string[] )
{
    return rng.nextArrayItem(a);
}

export default function nameGenerator(minLength : number, dataSet = PEOPLE)
{
    const { startLetters, letterStats, terminals } = dataSet;

    let word = choice(startLetters);
    const title = [word.toUpperCase()];
    while (letterStats.hasOwnProperty(word))
    {
        const next_words : string[] = letterStats[word];
        word = choice(next_words);

        const c = title[title.length - 1];
        if ( c  === " " || c === "'")
        {
            title.push(word.toUpperCase());
        }
        else
        {
            title.push(word);
        }

        if (title.length > minLength && terminals.hasOwnProperty(word))
        {
            break;
        }
    }
    if (title.length < minLength)
    {
        return nameGenerator(minLength, dataSet);
    }

    return title.join("");
};
