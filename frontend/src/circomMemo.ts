import {
  type BabyJub,
  buildBabyjub,
  buildEddsa,
  buildPoseidon,
  type Eddsa,
  type Poseidon,
} from "circomlibjs";

let poseidonP: Poseidon | null = null;

export async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonP) poseidonP = await buildPoseidon();
  return poseidonP;
}

let babyjubP: BabyJub | null = null;

export async function getBabyjub(): Promise<BabyJub> {
  if (!babyjubP) babyjubP = await buildBabyjub();
  return babyjubP;
}

let eddsaP: Eddsa | null = null;

export async function getEddsa(): Promise<Eddsa> {
  if (eddsaP === null) eddsaP = await buildEddsa();
  return eddsaP;
}
