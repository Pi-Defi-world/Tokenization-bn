import { getKeypairFromMnemonic } from "./utils/keypair"

// const mnemonic = "phone bottom maximum differ spike carry focus jungle guide plunge toilet power attract laptop minimum gorilla gossip sea flash glove rail cube service inner";
const mnemonic = "nest obscure exile ice tissue venture rookie chapter fork vast pizza catch wrong twist fatigue luxury cross dignity gravity seminar method transfer bone quality";

(async () => {
  await getKeypairFromMnemonic(mnemonic);
})();
